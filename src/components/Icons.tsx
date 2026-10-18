import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const LogoMark = (props: IconProps) => (
  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false" {...props}>
    <rect x="3" y="2" width="20" height="26" rx="3" fill="var(--accent)" opacity="0.35" />
    <rect x="9" y="4" width="20" height="26" rx="3" fill="var(--accent)" />
    <path d="M14 13h10M14 18h10M14 23h6" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const MergeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 3h7l4 4v6" />
    <path d="M14 3v4h4" />
    <path d="M7 3v18h6" />
    <path d="M16 16h6M19 13v6" />
  </Icon>
);

export const SplitIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="3" width="7" height="18" rx="1.5" />
    <rect x="13" y="3" width="7" height="18" rx="1.5" />
  </Icon>
);

export const CompressIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3M4 12h16" />
  </Icon>
);

export const ConvertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h13l-3-3M20 17H7l3 3" />
  </Icon>
);

export const ScanIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
  </Icon>
);

export const ImageIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m21 16-5-5-9 9" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowUpIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 6l-6 6 6 6" />
  </Icon>
);

export const FileIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Icon>
);

export const LockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const ExtractIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="3" width="10" height="14" rx="1.5" />
    <path d="M10 21h8a2 2 0 0 0 2-2V9" />
    <path d="M14 13l3 3 3-3M17 16V8" />
  </Icon>
);

export const WordIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M8 12l1.5 5 1.5-4 1.5 4L14 12" />
  </Icon>
);

export const BatchIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 3 8l9 5 9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Icon>
);

export const RemovePagesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 14h6" />
  </Icon>
);

export const OrganizeIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7" height="8" rx="1" />
    <rect x="14" y="3" width="7" height="8" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </Icon>
);

export const RotateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4v7h-7" />
  </Icon>
);

export const NumbersIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M10 15h1.5v3M10 18h3" />
  </Icon>
);

export const WatermarkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </Icon>
);

export const CropIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 2v14a2 2 0 0 0 2 2h14" />
    <path d="M18 22V8a2 2 0 0 0-2-2H2" />
  </Icon>
);

export const MarkdownIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 15V9l2.5 3L11 9v6M15 9v6M13 13l2 2 2-2" />
  </Icon>
);

export const SparkleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Icon>
);

export const TranslateIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 6 6 7M11 5c-.5 3-2.5 6-6 8" />
    <path d="M13 21l3.5-8 3.5 8M14.2 18h4.6" />
  </Icon>
);

export const SlidesIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M12 16v4M8 20h8M7 12l3-3 2 2 3-3" />
  </Icon>
);

export const SheetIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18" />
  </Icon>
);

export const CodeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
  </Icon>
);

export const ArchiveIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </Icon>
);

export const UnlockIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 7.5-2" />
  </Icon>
);

export const RepairIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
  </Icon>
);

export const CompareIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="7" height="16" rx="1" />
    <rect x="14" y="4" width="7" height="16" rx="1" />
    <path d="M12 2v20" />
  </Icon>
);

export const FormIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h4" />
  </Icon>
);

export const PenIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Icon>
);

export const SignIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 17c3-1 4-6 6-6s1 5 3 5 3-3 4-3 2 2 5 2" />
    <path d="M3 21h18" />
  </Icon>
);

export const RedactIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="6" y="9" width="8" height="2.5" fill="currentColor" />
    <rect x="6" y="13" width="11" height="2.5" fill="currentColor" />
  </Icon>
);
