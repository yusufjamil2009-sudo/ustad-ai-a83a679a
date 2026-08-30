import logo from "@/assets/ustad-logo.png";

/** Single official USTAD AI brand mark — reused in nav, welcome screen and favicon. */
export function UstadLogo({
  className = "size-9",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <img
      src={logo}
      alt="USTAD AI logo"
      width={1024}
      height={1024}
      loading={priority ? "eager" : "lazy"}
      className={`${className} object-contain select-none`}
      draggable={false}
    />
  );
}
