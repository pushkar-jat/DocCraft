//! Password protection (AES-256), unlocking with a known password, and structural repair.
//! DocCraft never guesses or cracks passwords: unlocking always requires the correct one.

use std::collections::BTreeMap;
use std::sync::Arc;

use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{Document, EncryptionState, EncryptionVersion, LoadOptions, Permissions};

use crate::compress::has_pdf_header;
use crate::errors::AppError;

const MAX_STREAM_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub struct Allowed {
    pub printing: bool,
    pub copying: bool,
    pub editing: bool,
}

fn not_pdf() -> AppError {
    AppError::new("not-pdf", "This file is damaged or is not a valid PDF.")
}

fn save(doc: &mut Document) -> Result<Vec<u8>, AppError> {
    let mut out = Vec::new();
    doc.save_to(&mut out).map_err(|_| AppError::internal())?;
    Ok(out)
}

fn load_plain(input: &[u8]) -> Result<Document, AppError> {
    if !has_pdf_header(input) {
        return Err(not_pdf());
    }
    let doc = Document::load_mem_with_options(input, LoadOptions::with_max_decompressed_size(MAX_STREAM_BYTES)).map_err(|_| not_pdf())?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err(AppError::new("encrypted", "This PDF is already password-protected. Unlock it first, then protect it again."));
    }
    Ok(doc)
}

/// Encrypts with AES-256 (PDF 2.0 / ISO 32000-2 security handler, revision 6).
/// An empty `user_password` means anyone can open the file, but the `owner_password`
/// is needed to lift the restrictions in `allowed`.
pub fn protect(input: &[u8], user_password: &str, owner_password: &str, allowed: Allowed) -> Result<Vec<u8>, AppError> {
    if user_password.is_empty() && owner_password.is_empty() {
        return Err(AppError::new("invalid-range", "Enter a password to open the PDF, a permissions password, or both."));
    }
    if user_password.chars().count() > 127 || owner_password.chars().count() > 127 {
        return Err(AppError::new("invalid-range", "Passwords can be at most 127 characters long."));
    }
    let mut doc = load_plain(input)?;
    if doc.get_pages().is_empty() {
        return Err(AppError::new("empty", "This PDF does not contain any pages."));
    }

    // Without an explicit permissions password, use a random one nobody knows, so the chosen
    // restrictions cannot be lifted by someone who only knows the open password.
    let mut random_owner = [0u8; 24];
    getrandom::fill(&mut random_owner).map_err(|_| AppError::internal())?;
    let generated_owner: String = random_owner.iter().map(|b| format!("{b:02x}")).collect();
    let owner = if owner_password.is_empty() { generated_owner.as_str() } else { owner_password };

    let mut permissions = Permissions::empty();
    if allowed.printing {
        permissions |= Permissions::PRINTABLE | Permissions::PRINTABLE_IN_HIGH_QUALITY;
    }
    if allowed.copying {
        permissions |= Permissions::COPYABLE | Permissions::COPYABLE_FOR_ACCESSIBILITY;
    } else {
        // Screen readers keep working even when copying is not allowed.
        permissions |= Permissions::COPYABLE_FOR_ACCESSIBILITY;
    }
    if allowed.editing {
        permissions |= Permissions::MODIFIABLE | Permissions::ANNOTABLE | Permissions::FILLABLE | Permissions::ASSEMBLABLE;
    }

    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|_| AppError::internal())?;
    let filter: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let state = EncryptionState::try_from(EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filter)]),
        file_encryption_key: &key,
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: owner,
        user_password,
        permissions,
    })
    .map_err(|_| AppError::new("invalid-range", "This password cannot be used. Try one without unusual control characters."))?;
    doc.encrypt(&state).map_err(|_| AppError::internal())?;
    save(&mut doc)
}

static ENCRYPT_REFERENCE: std::sync::LazyLock<regex::bytes::Regex> =
    std::sync::LazyLock::new(|| regex::bytes::Regex::new(r"/Encrypt\s*\d+\s+\d+\s+R").unwrap());

/// True if the file references an encryption dictionary (from its trailer or xref stream).
pub fn looks_encrypted(input: &[u8]) -> bool {
    ENCRYPT_REFERENCE.is_match(input)
}

/// Removes protection using the open (user) or permissions (owner) password.
pub fn unlock(input: &[u8], password: &str) -> Result<Vec<u8>, AppError> {
    if !has_pdf_header(input) {
        return Err(not_pdf());
    }
    if !looks_encrypted(input) {
        return Err(AppError::new("not-encrypted", "This PDF is not password-protected, so there is nothing to unlock."));
    }
    // Files that open without a password (restrictions only) decrypt with the empty password.
    let attempts: &[&str] = if password.is_empty() { &[""] } else { &[password, ""] };
    let mut last_error = None;
    for attempt in attempts {
        match Document::load_mem_with_options(input, LoadOptions { password: Some((*attempt).to_owned()), ..LoadOptions::with_max_decompressed_size(MAX_STREAM_BYTES) }) {
            // Note: if the typed password was wrong but the file only had restrictions,
            // the empty-password attempt still succeeds, which is the expected outcome.
            Ok(mut doc) if !doc.is_encrypted() && !doc.trailer.has(b"Encrypt") => return save(&mut doc),
            Ok(_) => last_error = Some(wrong_password(password)),
            Err(lopdf::Error::InvalidPassword) => last_error = Some(wrong_password(password)),
            Err(lopdf::Error::NotEncrypted) => return Err(AppError::new("not-encrypted", "This PDF is not password-protected, so there is nothing to unlock.")),
            Err(lopdf::Error::UnsupportedSecurityHandler(_)) => {
                return Err(AppError::new("unsupported", "This PDF uses a security method DocCraft does not support (for example certificate-based encryption)."));
            }
            Err(_) => last_error = Some(not_pdf()),
        }
    }
    Err(last_error.unwrap_or_else(|| wrong_password(password)))
}

fn wrong_password(password: &str) -> AppError {
    if password.is_empty() {
        AppError::new("wrong-password", "This PDF needs a password to open. Enter it to unlock the file.")
    } else {
        AppError::new("wrong-password", "That password is not correct for this PDF. Check it and try again.")
    }
}

/// Rebuilds a damaged PDF's structure (cross-reference table, object numbering, unused objects).
/// Returns the repaired bytes and the number of pages recovered. Files lopdf cannot parse at all
/// are left to the frontend's page-salvage fallback.
pub fn repair(input: &[u8]) -> Result<(Vec<u8>, usize), AppError> {
    let start = input.windows(5).position(|w| w == b"%PDF-").ok_or_else(not_pdf)?;
    let mut doc = Document::load_mem_with_options(&input[start..], LoadOptions::with_max_decompressed_size(MAX_STREAM_BYTES)).map_err(|_| not_pdf())?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err(AppError::new("encrypted", "This PDF is password-protected. Unlock it first, then repair it."));
    }
    let pages = doc.get_pages().len();
    if pages == 0 {
        return Err(AppError::new("empty", "No pages could be recovered from this PDF."));
    }
    doc.prune_objects();
    doc.renumber_objects();
    let out = save(&mut doc)?;
    // Only report success for output that loads again with the same page count.
    let check = Document::load_mem(&out).map_err(|_| AppError::internal())?;
    if check.get_pages().len() != pages {
        return Err(AppError::internal());
    }
    Ok((out, pages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compress::tests::pdf_with_text;

    fn text(pdf: &[u8], password: Option<&str>) -> String {
        let options = LoadOptions { password: password.map(str::to_owned), ..LoadOptions::default() };
        let doc = Document::load_mem_with_options(pdf, options).unwrap();
        doc.extract_text(&[1]).unwrap_or_default()
    }

    fn permissions_of(pdf: &[u8]) -> i64 {
        let doc = Document::load_mem(pdf).unwrap();
        let reference = doc.trailer.get(b"Encrypt").unwrap().as_reference().unwrap();
        doc.get_object(reference).unwrap().as_dict().unwrap().get(b"P").unwrap().as_i64().unwrap()
    }

    #[test]
    fn protects_with_aes256_and_hides_the_content() {
        let input = pdf_with_text();
        let protected = protect(&input, "open-sesame", "", Allowed { printing: true, ..Default::default() }).unwrap();
        assert!(!protected.windows(8).any(|w| w == b"DocCraft"), "plaintext must not be visible");
        let doc = Document::load_mem(&protected).unwrap();
        assert!(doc.is_encrypted());
        let encrypt = doc.get_object(doc.trailer.get(b"Encrypt").unwrap().as_reference().unwrap()).unwrap().as_dict().unwrap();
        assert_eq!(encrypt.get(b"V").unwrap().as_i64().unwrap(), 5, "AES-256 security handler");
        assert!(text(&protected, Some("open-sesame")).contains("DocCraft keeps documents local."));
        assert!(Document::load_mem_with_options(&protected, LoadOptions::with_password("nope")).is_err());
    }

    #[test]
    fn sets_the_requested_permissions() {
        let input = pdf_with_text();
        let print_only = permissions_of(&protect(&input, "pw", "", Allowed { printing: true, ..Default::default() }).unwrap());
        assert_ne!(print_only & (1 << 2), 0, "printing allowed");
        assert_eq!(print_only & (1 << 4), 0, "copying not allowed");
        assert_eq!(print_only & (1 << 3), 0, "editing not allowed");
        let everything = permissions_of(&protect(&input, "pw", "", Allowed { printing: true, copying: true, editing: true }).unwrap());
        assert_ne!(everything & (1 << 4), 0);
        assert_ne!(everything & (1 << 3), 0);
    }

    #[test]
    fn restrictions_only_protection_opens_without_password() {
        let protected = protect(&pdf_with_text(), "", "owner-secret", Allowed::default()).unwrap();
        assert!(text(&protected, Some("")).contains("DocCraft"));
    }

    #[test]
    fn unlocks_only_with_the_right_password() {
        let protected = protect(&pdf_with_text(), "right", "owner", Allowed::default()).unwrap();
        assert_eq!(unlock(&protected, "wrong").unwrap_err().code, "wrong-password");
        assert_eq!(unlock(&protected, "").unwrap_err().code, "wrong-password");
        for password in ["right", "owner"] {
            let unlocked = unlock(&protected, password).unwrap();
            let doc = Document::load_mem(&unlocked).unwrap();
            assert!(!doc.is_encrypted() && !doc.trailer.has(b"Encrypt"));
            assert!(doc.extract_text(&[1]).unwrap().contains("DocCraft"));
        }
    }

    #[test]
    fn unlocks_restriction_only_files_without_a_password() {
        let protected = protect(&pdf_with_text(), "", "owner-secret", Allowed::default()).unwrap();
        let unlocked = unlock(&protected, "").unwrap();
        assert!(!Document::load_mem(&unlocked).unwrap().is_encrypted());
    }

    #[test]
    fn refuses_to_unlock_or_reprotect_wrong_inputs() {
        assert_eq!(unlock(&pdf_with_text(), "x").unwrap_err().code, "not-encrypted");
        let protected = protect(&pdf_with_text(), "a", "", Allowed::default()).unwrap();
        assert_eq!(protect(&protected, "b", "", Allowed::default()).unwrap_err().code, "encrypted");
        assert_eq!(protect(&pdf_with_text(), "", "", Allowed::default()).unwrap_err().code, "invalid-range");
        assert_eq!(unlock(b"hello", "x").unwrap_err().code, "not-pdf");
    }

    #[test]
    fn repairs_broken_cross_reference_offsets_and_leading_junk() {
        let good = pdf_with_text();
        // Junk before the header shifts every xref offset.
        let mut shifted = b"garbage line from a broken download\r\n".to_vec();
        shifted.extend_from_slice(&good);
        let (fixed, pages) = repair(&shifted).unwrap();
        assert_eq!(pages, 1);
        assert!(fixed.starts_with(b"%PDF-"));
        assert!(Document::load_mem(&fixed).unwrap().extract_text(&[1]).unwrap().contains("DocCraft"));
        assert_eq!(repair(b"not a pdf at all").unwrap_err().code, "not-pdf");
    }
}
