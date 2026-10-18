//! Certificate-based PDF signing (PAdES baseline B-B: ETSI.CAdES.detached, SHA-256) with the
//! user's own PKCS#12 (.pfx / .p12) certificate. RSA and ECDSA (P-256, P-384) keys are supported.
//!
//! The signature covers the whole file except the /Contents hex string, as required by ISO 32000:
//! the document is saved with fixed-size placeholders, the byte range is written in place, the
//! ranges are hashed, and the DER-encoded CMS SignedData is written into the placeholder.

use std::time::{SystemTime, UNIX_EPOCH};

use cms::builder::{SignedDataBuilder, SignerInfoBuilder};
use cms::cert::{CertificateChoices, IssuerAndSerialNumber};
use cms::signed_data::{EncapsulatedContentInfo, SignerIdentifier};
use const_oid::ObjectIdentifier;
use der::asn1::SetOfVec;
use der::{Any, Decode, Encode};
use lopdf::{dictionary, text_string, Document, Object, ObjectId, Stream, StringFormat};
use serde::Serialize;
use sha2::{Digest, Sha256};
use signature::{Keypair, Signer};
use spki::{AlgorithmIdentifierOwned, DynSignatureAlgorithmIdentifier, SignatureBitStringEncoding};
use x509_cert::attr::Attribute;
use x509_cert::Certificate;

use crate::compress::has_pdf_header;
use crate::errors::AppError;

/// Room reserved for the CMS signature (bytes). Generous for RSA-4096 with a certificate chain.
const CONTENTS_LEN: usize = 24 * 1024;
const BYTE_RANGE_PLACEHOLDER: &str = "9999999999 9999999999 9999999999";

const ID_DATA: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.7.1");
const ID_SHA_256: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.16.840.1.101.3.4.2.1");
const ID_AA_SIGNING_CERTIFICATE_V2: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.16.2.47");
const ID_COMMON_NAME: ObjectIdentifier = ObjectIdentifier::new_unwrap("2.5.4.3");

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CertificateInfo {
    pub subject: String,
    pub issuer: String,
    /// Unix seconds.
    pub valid_from: u64,
    pub valid_to: u64,
    pub self_signed: bool,
    pub key_type: String,
}

enum Key {
    Rsa(Box<rsa::RsaPrivateKey>),
    P256(p256::SecretKey),
    P384(p384::SecretKey),
}

struct Identity {
    key: Key,
    /// Signer certificate first, then the rest of the chain.
    chain: Vec<Certificate>,
}

fn bad_certificate() -> AppError {
    AppError::new("wrong-password", "The certificate file could not be opened. Check the password and that it is a .pfx or .p12 file with a private key.")
}

fn common_name(name: &x509_cert::name::Name) -> String {
    for rdn in name.0.iter() {
        for atv in rdn.0.iter() {
            if atv.oid == ID_COMMON_NAME {
                if let Ok(value) = atv.value.decode_as::<der::asn1::Utf8StringRef>() {
                    return value.as_str().to_owned();
                }
                if let Ok(value) = atv.value.decode_as::<der::asn1::PrintableStringRef>() {
                    return value.as_str().to_owned();
                }
            }
        }
    }
    name.to_string()
}

fn load_identity(p12: &[u8], password: &str) -> Result<Identity, AppError> {
    let store = p12_keystore::KeyStore::from_pkcs12(p12, password, p12_keystore::Pkcs12ImportPolicy::Relaxed).map_err(|_| bad_certificate())?;
    let (_, chain) = store.private_key_chain().ok_or_else(|| AppError::new("unsupported", "This certificate file does not contain a private key, so it cannot sign."))?;
    let pkcs8 = chain.key().as_der();
    use rsa::pkcs8::DecodePrivateKey;
    let key = if let Ok(key) = rsa::RsaPrivateKey::from_pkcs8_der(pkcs8) {
        Key::Rsa(Box::new(key))
    } else if let Ok(key) = p256::SecretKey::from_pkcs8_der(pkcs8) {
        Key::P256(key)
    } else if let Ok(key) = p384::SecretKey::from_pkcs8_der(pkcs8) {
        Key::P384(key)
    } else {
        return Err(AppError::new("unsupported", "This certificate uses a key type DocCraft cannot sign with (supported: RSA, ECDSA P-256 and P-384)."));
    };
    let chain: Vec<Certificate> = chain.certs().iter().filter_map(|cert| Certificate::from_der(cert.as_der()).ok()).collect();
    if chain.is_empty() {
        return Err(AppError::new("unsupported", "The certificate file has a private key but no certificate."));
    }
    Ok(Identity { key, chain })
}

fn unix(time: &x509_cert::time::Time) -> u64 {
    time.to_unix_duration().as_secs()
}

pub fn certificate_info(p12: &[u8], password: &str) -> Result<CertificateInfo, AppError> {
    let identity = load_identity(p12, password)?;
    let tbs = &identity.chain[0].tbs_certificate;
    Ok(CertificateInfo {
        subject: common_name(&tbs.subject),
        issuer: common_name(&tbs.issuer),
        valid_from: unix(&tbs.validity.not_before),
        valid_to: unix(&tbs.validity.not_after),
        self_signed: tbs.subject == tbs.issuer,
        key_type: match identity.key {
            Key::Rsa(_) => "RSA",
            Key::P256(_) => "ECDSA P-256",
            Key::P384(_) => "ECDSA P-384",
        }
        .to_owned(),
    })
}

/// "D:YYYYMMDDHHmmSS+00'00'" (UTC) for the signature's /M entry.
fn pdf_date(unix_seconds: u64) -> String {
    let days = (unix_seconds / 86_400) as i64;
    let rem = unix_seconds % 86_400;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("D:{year:04}{month:02}{day:02}{:02}{:02}{:02}+00'00'", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn der_with_header(tag: u8, content: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let len = content.len();
    if len < 0x80 {
        out.push(len as u8);
    } else if len <= 0xFF {
        out.extend_from_slice(&[0x81, len as u8]);
    } else {
        out.extend_from_slice(&[0x82, (len >> 8) as u8, len as u8]);
    }
    out.extend_from_slice(content);
    out
}

/// ESS signing-certificate-v2 (RFC 5035), required by PAdES: binds the signer certificate's hash.
fn signing_certificate_v2(cert: &Certificate) -> Result<Attribute, AppError> {
    let cert_der = cert.to_der().map_err(|_| AppError::internal())?;
    let hash = Sha256::digest(&cert_der);
    // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }
    // ESSCertIDv2 ::= SEQUENCE { certHash OCTET STRING }   (hashAlgorithm defaults to SHA-256)
    let ess_cert_id = der_with_header(0x30, &der_with_header(0x04, &hash));
    let value = der_with_header(0x30, &der_with_header(0x30, &ess_cert_id));
    let any = Any::from_der(&value).map_err(|_| AppError::internal())?;
    Ok(Attribute { oid: ID_AA_SIGNING_CERTIFICATE_V2, values: SetOfVec::try_from(vec![any]).map_err(|_| AppError::internal())? })
}

fn build_cms<S, Sig>(signer: &S, chain: &[Certificate], digest: &[u8]) -> Result<Vec<u8>, AppError>
where
    S: Keypair + DynSignatureAlgorithmIdentifier + Signer<Sig>,
    Sig: SignatureBitStringEncoding,
{
    fn failed<E>(_: E) -> AppError {
        AppError::new("internal", "The signature could not be created with this certificate.")
    }
    let content = EncapsulatedContentInfo { econtent_type: ID_DATA, econtent: None };
    let cert = &chain[0];
    let sid = SignerIdentifier::IssuerAndSerialNumber(IssuerAndSerialNumber {
        issuer: cert.tbs_certificate.issuer.clone(),
        serial_number: cert.tbs_certificate.serial_number.clone(),
    });
    let digest_algorithm = AlgorithmIdentifierOwned { oid: ID_SHA_256, parameters: None };
    let mut signer_info = SignerInfoBuilder::new(signer, sid, digest_algorithm.clone(), &content, Some(digest)).map_err(failed)?;
    signer_info.add_signed_attribute(signing_certificate_v2(cert)?).map_err(failed)?;

    let mut builder = SignedDataBuilder::new(&content);
    builder.add_digest_algorithm(digest_algorithm).map_err(failed)?;
    for certificate in chain {
        builder.add_certificate(CertificateChoices::Certificate(certificate.clone())).map_err(failed)?;
    }
    builder.add_signer_info::<S, Sig>(signer_info).map_err(failed)?;
    builder.build().map_err(failed)?.to_der().map_err(failed)
}

fn sign_digest(identity: &Identity, digest: &[u8]) -> Result<Vec<u8>, AppError> {
    match &identity.key {
        Key::Rsa(key) => build_cms::<_, rsa::pkcs1v15::Signature>(&rsa::pkcs1v15::SigningKey::<Sha256>::new((**key).clone()), &identity.chain, digest),
        Key::P256(key) => build_cms::<_, p256::ecdsa::DerSignature>(&p256::ecdsa::SigningKey::from(key), &identity.chain, digest),
        Key::P384(key) => build_cms::<_, p384::ecdsa::DerSignature>(&p384::ecdsa::SigningKey::from(key), &identity.chain, digest),
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn dict_mut<'a>(doc: &'a mut Document, object: &Object) -> Option<&'a mut lopdf::Dictionary> {
    match object {
        Object::Reference(id) => doc.get_object_mut(*id).ok()?.as_dict_mut().ok(),
        _ => None,
    }
}

/// True if any form field already holds a signature value.
fn has_existing_signature(doc: &Document) -> bool {
    doc.objects.values().any(|object| {
        object.as_dict().is_ok_and(|dict| dict.get(b"FT").and_then(Object::as_name).is_ok_and(|ft| ft == b"Sig") && dict.has(b"V"))
    })
}

pub struct SignOptions {
    /// 0-based page index for the signature field.
    pub page: usize,
    /// Field rectangle in PDF user space [x1, y1, x2, y2]; None = invisible signature.
    pub rect: Option<[f64; 4]>,
    pub reason: String,
    pub location: String,
}

pub fn sign_pdf(pdf: &[u8], p12: &[u8], password: &str, options: &SignOptions) -> Result<Vec<u8>, AppError> {
    let identity = load_identity(p12, password)?;
    let tbs = &identity.chain[0].tbs_certificate;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| AppError::internal())?.as_secs();
    if now > unix(&tbs.validity.not_after) {
        return Err(AppError::new("unsupported", "This certificate has expired, so signatures made with it would not be valid."));
    }
    if now < unix(&tbs.validity.not_before) {
        return Err(AppError::new("unsupported", "This certificate is not valid yet."));
    }

    if !has_pdf_header(pdf) {
        return Err(AppError::new("not-pdf", "This file is damaged or is not a valid PDF."));
    }
    let mut doc = Document::load_mem(pdf).map_err(|_| AppError::new("not-pdf", "This file is damaged or is not a valid PDF."))?;
    if doc.is_encrypted() || doc.trailer.has(b"Encrypt") {
        return Err(AppError::new("encrypted", "This PDF is password-protected. Unlock it first, then sign it."));
    }
    if has_existing_signature(&doc) {
        return Err(AppError::new(
            "unsupported",
            "This PDF is already digitally signed. Adding another certificate signature would invalidate the existing one, so DocCraft does not do that yet.",
        ));
    }
    let pages = doc.get_pages();
    let page_id = *pages.values().nth(options.page).ok_or_else(|| AppError::bad_request("page"))?;

    let signer_name = common_name(&tbs.subject);
    let mut sig = dictionary! {
        "Type" => "Sig",
        "Filter" => "Adobe.PPKLite",
        "SubFilter" => "ETSI.CAdES.detached",
        "ByteRange" => vec![0.into(), 9_999_999_999i64.into(), 9_999_999_999i64.into(), 9_999_999_999i64.into()],
        "Contents" => Object::String(vec![0u8; CONTENTS_LEN], StringFormat::Hexadecimal),
        "M" => Object::string_literal(pdf_date(now)),
        "Name" => text_string(&signer_name),
    };
    if !options.reason.trim().is_empty() {
        sig.set("Reason", text_string(options.reason.trim()));
    }
    if !options.location.trim().is_empty() {
        sig.set("Location", text_string(options.location.trim()));
    }
    let sig_id = doc.add_object(sig);

    let rect = options.rect.unwrap_or([0.0, 0.0, 0.0, 0.0]);
    let (width, height) = ((rect[2] - rect[0]).abs(), (rect[3] - rect[1]).abs());
    let appearance = doc.add_object(Stream::new(
        dictionary! { "Type" => "XObject", "Subtype" => "Form", "BBox" => vec![0.into(), 0.into(), (width as f32).into(), (height as f32).into()] },
        Vec::new(),
    ));
    let field_name = (1..).map(|n| format!("Signature{n}")).find(|name| !doc.objects.values().any(|o| o.as_dict().is_ok_and(|d| d.get(b"T").is_ok_and(|t| t.as_str().is_ok_and(|s| s == name.as_bytes()))))).unwrap();
    let widget_id = doc.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Sig",
        "T" => text_string(&field_name),
        "V" => sig_id,
        "F" => 132,
        "Rect" => rect.iter().map(|v| Object::Real(*v as f32)).collect::<Vec<_>>(),
        "P" => page_id,
        "AP" => dictionary! { "N" => appearance },
    });

    add_annotation(&mut doc, page_id, widget_id)?;
    add_to_acroform(&mut doc, widget_id)?;

    // Classic cross-reference table, no object streams: the placeholders must stay as plain bytes.
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).map_err(|_| AppError::internal())?;

    let contents_needle: Vec<u8> = std::iter::once(b'<').chain(std::iter::repeat_n(b'0', CONTENTS_LEN * 2)).chain(std::iter::once(b'>')).collect();
    let start = find(&bytes, &contents_needle).ok_or_else(AppError::internal)?;
    let end = start + contents_needle.len();
    let range_at = find(&bytes, BYTE_RANGE_PLACEHOLDER.as_bytes()).ok_or_else(AppError::internal)?;
    let range = format!("{start} {end} {}", bytes.len() - end);
    if range.len() > BYTE_RANGE_PLACEHOLDER.len() {
        return Err(AppError::new("too-large", "This PDF is too large to sign."));
    }
    let padded = format!("{range:<width$}", width = BYTE_RANGE_PLACEHOLDER.len());
    bytes[range_at..range_at + padded.len()].copy_from_slice(padded.as_bytes());

    let mut hasher = Sha256::new();
    hasher.update(&bytes[..start]);
    hasher.update(&bytes[end..]);
    let digest = hasher.finalize();

    let cms = sign_digest(&identity, &digest)?;
    if cms.len() > CONTENTS_LEN {
        return Err(AppError::new("unsupported", "This certificate chain is too large for DocCraft's signature space."));
    }
    let hex: String = cms.iter().map(|b| format!("{b:02X}")).collect();
    bytes[start + 1..start + 1 + hex.len()].copy_from_slice(hex.as_bytes());
    Ok(bytes)
}

fn add_annotation(doc: &mut Document, page_id: ObjectId, widget_id: ObjectId) -> Result<(), AppError> {
    let annots = doc.get_object(page_id).and_then(Object::as_dict).map_err(|_| AppError::internal())?.get(b"Annots").ok().cloned();
    match annots {
        Some(Object::Array(mut list)) => {
            list.push(widget_id.into());
            doc.get_object_mut(page_id).and_then(Object::as_dict_mut).map_err(|_| AppError::internal())?.set("Annots", list);
        }
        Some(Object::Reference(id)) => {
            doc.get_object_mut(id).and_then(Object::as_array_mut).map_err(|_| AppError::internal())?.push(widget_id.into());
        }
        _ => {
            doc.get_object_mut(page_id).and_then(Object::as_dict_mut).map_err(|_| AppError::internal())?.set("Annots", vec![widget_id.into()]);
        }
    }
    Ok(())
}

fn add_to_acroform(doc: &mut Document, widget_id: ObjectId) -> Result<(), AppError> {
    let root = doc.trailer.get(b"Root").map_err(|_| AppError::internal())?.clone();
    let acroform = dict_mut(doc, &root).ok_or_else(AppError::internal)?.get(b"AcroForm").ok().cloned();
    let acroform_id = match acroform {
        Some(Object::Reference(id)) => id,
        Some(Object::Dictionary(dict)) => doc.add_object(dict),
        _ => doc.add_object(dictionary! { "Fields" => Vec::<Object>::new() }),
    };
    dict_mut(doc, &root).ok_or_else(AppError::internal)?.set("AcroForm", acroform_id);
    let fields = doc.get_object(acroform_id).and_then(Object::as_dict).map_err(|_| AppError::internal())?.get(b"Fields").ok().cloned();
    match fields {
        Some(Object::Reference(id)) => doc.get_object_mut(id).and_then(Object::as_array_mut).map_err(|_| AppError::internal())?.push(widget_id.into()),
        Some(Object::Array(mut list)) => {
            list.push(widget_id.into());
            doc.get_object_mut(acroform_id).and_then(Object::as_dict_mut).map_err(|_| AppError::internal())?.set("Fields", list);
        }
        _ => doc.get_object_mut(acroform_id).and_then(Object::as_dict_mut).map_err(|_| AppError::internal())?.set("Fields", vec![widget_id.into()]),
    }
    doc.get_object_mut(acroform_id).and_then(Object::as_dict_mut).map_err(|_| AppError::internal())?.set("SigFlags", 3);
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::compress::tests::pdf_with_text;
    use cms::content_info::ContentInfo;
    use cms::signed_data::SignedData;
    use std::str::FromStr;
    use std::time::Duration;
    use x509_cert::builder::{Builder, CertificateBuilder, Profile};
    use x509_cert::name::Name;
    use x509_cert::serial_number::SerialNumber;
    use x509_cert::spki::SubjectPublicKeyInfoOwned;
    use x509_cert::time::Validity;

    const ID_MESSAGE_DIGEST: ObjectIdentifier = ObjectIdentifier::new_unwrap("1.2.840.113549.1.9.4");

    fn p12_for(pkcs8: &[u8], cert: &Certificate, password: &str) -> Vec<u8> {
        let mut store = p12_keystore::KeyStore::new();
        let chain = p12_keystore::PrivateKeyChain::new(
            "signer",
            p12_keystore::PrivateKey::from_der(pkcs8).unwrap(),
            [p12_keystore::Certificate::from_der(&cert.to_der().unwrap()).unwrap()],
        );
        store.add_entry("signer", p12_keystore::KeyStoreEntry::PrivateKeyChain(chain));
        store.writer(password).write().unwrap()
    }

    pub(crate) fn rsa_identity() -> Vec<u8> {
        use rsa::pkcs8::EncodePrivateKey;
        let key = rsa::RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).unwrap();
        let signer = rsa::pkcs1v15::SigningKey::<Sha256>::new(key.clone());
        let spki = SubjectPublicKeyInfoOwned::from_key(key.to_public_key()).unwrap();
        let builder = CertificateBuilder::new(
            Profile::Root,
            SerialNumber::from(7u32),
            Validity::from_now(Duration::from_secs(86_400)).unwrap(),
            Name::from_str("CN=DocCraft Test Signer,O=DocCraft").unwrap(),
            spki,
            &signer,
        )
        .unwrap();
        let cert = builder.build::<rsa::pkcs1v15::Signature>().unwrap();
        p12_for(key.to_pkcs8_der().unwrap().as_bytes(), &cert, "test-pw")
    }

    fn p256_identity() -> Vec<u8> {
        use p256::pkcs8::EncodePrivateKey;
        let secret = p256::SecretKey::random(&mut rand::rngs::OsRng);
        let signer = p256::ecdsa::SigningKey::from(&secret);
        let spki = SubjectPublicKeyInfoOwned::from_key(*signer.verifying_key()).unwrap();
        let builder = CertificateBuilder::new(
            Profile::Root,
            SerialNumber::from(9u32),
            Validity::from_now(Duration::from_secs(86_400)).unwrap(),
            Name::from_str("CN=DocCraft EC Signer").unwrap(),
            spki,
            &signer,
        )
        .unwrap();
        let cert = builder.build::<p256::ecdsa::DerSignature>().unwrap();
        p12_for(secret.to_pkcs8_der().unwrap().as_bytes(), &cert, "ec-pw")
    }

    fn options() -> SignOptions {
        SignOptions { page: 0, rect: Some([400.0, 50.0, 560.0, 110.0]), reason: "Approved".into(), location: "Pune".into() }
    }

    /// Independently checks a signed PDF: byte range, message digest and the CMS signature.
    pub(crate) fn verify(signed: &[u8]) -> Result<(), String> {
        let doc = Document::load_mem(signed).map_err(|e| format!("reload: {e:?}"))?;
        let sig = doc
            .objects
            .values()
            .find_map(|o| o.as_dict().ok().filter(|d| d.get(b"Type").and_then(Object::as_name).is_ok_and(|t| t == b"Sig")))
            .ok_or("no /Sig dictionary")?;
        let range: Vec<usize> = sig.get(b"ByteRange").unwrap().as_array().unwrap().iter().map(|v| v.as_i64().unwrap() as usize).collect();
        let contents = sig.get(b"Contents").unwrap().as_str().unwrap();
        if range[0] != 0 || range[2] + range[3] != signed.len() || signed[range[1]] != b'<' || signed[range[2] - 1] != b'>' {
            return Err(format!("byte range {range:?} does not exclude exactly the /Contents string"));
        }
        let mut hasher = Sha256::new();
        hasher.update(&signed[..range[1]]);
        hasher.update(&signed[range[2]..range[2] + range[3]]);
        let digest = hasher.finalize();

        let len = 4 + u16::from_be_bytes([contents[2], contents[3]]) as usize;
        let info = ContentInfo::from_der(&contents[..len]).map_err(|e| format!("cms: {e}"))?;
        let signed_data: SignedData = info.content.decode_as().map_err(|e| format!("signed data: {e}"))?;
        let signer = signed_data.signer_infos.0.get(0).unwrap();
        let attrs = signer.signed_attrs.as_ref().ok_or("no signed attributes")?;
        let md = attrs.iter().find(|a| a.oid == ID_MESSAGE_DIGEST).ok_or("no message digest")?;
        let md = md.values.get(0).unwrap().decode_as::<der::asn1::OctetString>().unwrap();
        if md.as_bytes() != digest.as_slice() {
            return Err("message digest does not match the signed byte ranges".into());
        }
        if !attrs.iter().any(|a| a.oid == ID_AA_SIGNING_CERTIFICATE_V2) {
            return Err("missing signing-certificate-v2".into());
        }
        let attrs_der = attrs.to_der().unwrap();
        let cert = match signed_data.certificates.as_ref().unwrap().0.get(0).unwrap() {
            CertificateChoices::Certificate(cert) => cert.clone(),
            _ => return Err("no certificate".into()),
        };
        let spki_der = cert.tbs_certificate.subject_public_key_info.to_der().unwrap();
        let sig_bytes = signer.signature.as_bytes();
        use signature::Verifier;
        use spki::DecodePublicKey;
        if let Ok(public) = rsa::RsaPublicKey::from_public_key_der(&spki_der) {
            let key = rsa::pkcs1v15::VerifyingKey::<Sha256>::new(public);
            key.verify(&attrs_der, &rsa::pkcs1v15::Signature::try_from(sig_bytes).unwrap()).map_err(|_| "RSA signature invalid".to_string())
        } else {
            let key = p256::ecdsa::VerifyingKey::from_public_key_der(&spki_der).map_err(|_| "unknown key".to_string())?;
            key.verify(&attrs_der, &p256::ecdsa::DerSignature::from_bytes(sig_bytes).unwrap()).map_err(|_| "ECDSA signature invalid".to_string())
        }
    }

    #[test]
    fn signs_with_rsa_and_the_signature_verifies() {
        let signed = sign_pdf(&pdf_with_text(), &rsa_identity(), "test-pw", &options()).unwrap();
        verify(&signed).unwrap();
        let doc = Document::load_mem(&signed).unwrap();
        assert_eq!(doc.get_pages().len(), 1);
        assert!(doc.extract_text(&[1]).unwrap().contains("DocCraft keeps documents local."));
    }

    #[test]
    fn signs_with_ecdsa_p256() {
        let signed = sign_pdf(&pdf_with_text(), &p256_identity(), "ec-pw", &SignOptions { rect: None, ..options() }).unwrap();
        verify(&signed).unwrap();
    }

    #[test]
    fn any_change_after_signing_breaks_verification() {
        let mut signed = sign_pdf(&pdf_with_text(), &rsa_identity(), "test-pw", &options()).unwrap();
        let at = signed.windows(8).position(|w| w == b"DocCraft").unwrap();
        signed[at] = b'X';
        assert!(verify(&signed).unwrap_err().contains("message digest"));
    }

    #[test]
    fn reads_certificate_details_and_rejects_wrong_password() {
        let p12 = rsa_identity();
        let info = certificate_info(&p12, "test-pw").unwrap();
        assert_eq!(info.subject, "DocCraft Test Signer");
        assert!(info.self_signed);
        assert_eq!(info.key_type, "RSA");
        assert_eq!(certificate_info(&p12, "nope").unwrap_err().code, "wrong-password");
    }

    #[test]
    fn refuses_to_sign_twice_or_sign_encrypted_files() {
        let p12 = rsa_identity();
        let signed = sign_pdf(&pdf_with_text(), &p12, "test-pw", &options()).unwrap();
        assert_eq!(sign_pdf(&signed, &p12, "test-pw", &options()).unwrap_err().code, "unsupported");
        let protected = crate::security::protect(&pdf_with_text(), "pw", "", crate::security::Allowed::default()).unwrap();
        assert_eq!(sign_pdf(&protected, &p12, "test-pw", &options()).unwrap_err().code, "encrypted");
    }

    /// Writes a signed sample for checking with other tools when DOCCRAFT_SIGN_SAMPLE is set.
    #[test]
    fn writes_sample_for_external_verification() {
        let Ok(path) = std::env::var("DOCCRAFT_SIGN_SAMPLE") else { return };
        let signed = sign_pdf(&pdf_with_text(), &rsa_identity(), "test-pw", &options()).unwrap();
        std::fs::write(path, signed).unwrap();
    }

    #[test]
    fn formats_pdf_dates() {
        assert_eq!(pdf_date(0), "D:19700101000000+00'00'");
        assert_eq!(pdf_date(1_760_000_000), "D:20251009085320+00'00'");
    }
}
