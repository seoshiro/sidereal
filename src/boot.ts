import "./style.css";
import { applyPalette } from "./palette";
applyPalette();
let timeout: number;
async function prepare() {
  const app = document.querySelector<HTMLElement>("#app")!;
  app.inert = true;
  const status = document.querySelector<HTMLElement>("#boot-status")!;
  const ru = (() => {
    try {
      return localStorage.getItem("sidereal.language") === "ru";
    } catch {
      return false;
    }
  })();
  status.textContent = ru
    ? "Готовим музыкальную обсерваторию"
    : "Preparing your observatory";
  try {
    const module = await Promise.race([
      import("./main"),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(Error("Preparation timed out")),
          12000,
        );
      }),
    ]);
    clearTimeout(timeout!);
    app.inert = false;
    await module.initialize();
    const initialFocus = document.activeElement as HTMLElement;
    app.inert = true;
    // User-requested two-second pause after real preparation, including reduced motion.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
    app.inert = false;
    if (initialFocus !== document.body && initialFocus.isConnected)
      initialFocus.focus({ preventScroll: true });
    document.querySelector("#app")?.removeAttribute("aria-busy");
    const screen = document.querySelector<HTMLElement>("#boot-screen")!;
    screen.classList.add("ready");
    screen.addEventListener("transitionend", () => screen.remove(), {
      once: true,
    });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) screen.remove();
  } catch {
    app.inert = true;
    clearTimeout(timeout!);
    (
      window as unknown as { siderealBootFailure: () => void }
    ).siderealBootFailure();
  }
}
void prepare();
