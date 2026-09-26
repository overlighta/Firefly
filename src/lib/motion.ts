// Animate content, never the containers that position navigation or floating controls.
const revealTargets = [
  ".memory-day", ".memory-gallery", ".memory-perspective", ".memory-card",
  ".memory-timeline-year > header", ".memory-timeline-item__body", ".memory-real-card",
  ".memory-map-canvas__watermark", ".memory-place-list > article",
  ".memory-space-person", ".memory-space-portrait__archive", ".memory-space-stats > div",
  ".memory-space-notes article", ".memory-detail__hero", ".journal-search__results > a",
].join(",");

export function revealSections(node: HTMLElement, _route: string) {
  if (!window.IntersectionObserver || !node.animate) return {};
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const running = new Set<Animation>();
  const pending = new Set<HTMLElement>();
  let seen = new WeakSet<Element>();
  let frame = 0;
  let disposed = false;
  const observer = new IntersectionObserver(entries => {
    let order = 0;
    for (const entry of entries) {
      if (!entry.isIntersecting || preference.matches || document.hidden) continue;
      const element = entry.target as HTMLElement;
      if (element.closest("[hidden]")) continue;
      observer.unobserve(element);
      pending.delete(element);
      const animation = element.animate([
        { opacity: 0.65, transform: "translateY(10px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 340, delay: Math.min(order++ * 30, 90), easing: "cubic-bezier(.2,.7,.25,1)" });
      animation.id = "journal-reveal";
      running.add(animation);
      animation.onfinish = animation.oncancel = () => running.delete(animation);
    }
  }, { threshold: 0.08 });

  function scan() {
    frame = 0;
    if (disposed || preference.matches || document.hidden) return;
    for (const element of pending) {
      if (!element.isConnected || element.closest("[hidden]")) {
        observer.unobserve(element); pending.delete(element);
      }
    }
    for (const element of node.querySelectorAll<HTMLElement>(revealTargets)) {
      if (seen.has(element) || element.closest("[hidden]")) continue;
      seen.add(element);
      pending.add(element);
      observer.observe(element);
    }
  }
  function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(scan); }
  function cancel() {
    observer.disconnect();
    pending.clear();
    for (const animation of running) animation.cancel();
    running.clear();
    cancelAnimationFrame(frame); frame = 0;
  }
  function restart() { cancel(); seen = new WeakSet(); schedule(); }
  function visibilityChanged() { if (document.hidden) cancel(); else restart(); }
  // Observe data arriving after the page has mounted; no polling or scroll handlers.
  const mutations = new MutationObserver(schedule);
  mutations.observe(node, { childList: true, subtree: true });
  preference.addEventListener("change", restart);
  document.addEventListener("visibilitychange", visibilityChanged);
  schedule();
  return {
    update: restart,
    destroy() {
      disposed = true; cancel(); mutations.disconnect();
      preference.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", visibilityChanged);
    },
  };
}

export function navIndicator(node: HTMLElement, _active: string) {
  let frame = 0;
  function measure() {
    frame = 0;
    const active = node.querySelector<HTMLElement>("a.is-active");
    node.dataset.hasActive = String(Boolean(active));
    if (!active) return;
    node.style.setProperty("--nav-x", `${active.offsetLeft}px`);
    node.style.setProperty("--nav-y", `${active.offsetTop + 5}px`);
    node.style.setProperty("--nav-width", `${active.offsetWidth}px`);
    node.style.setProperty("--nav-height", `${Math.max(0, active.offsetHeight - 10)}px`);
  }
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  schedule();
  return { update: schedule, destroy() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
