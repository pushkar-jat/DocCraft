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
