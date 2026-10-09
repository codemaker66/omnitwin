// /platform: progressive behaviour only. The page reads completely without it.
(() => {
  // The head marks the page "js" before it paints, and falls back to the
  // still page if this script has not said it is ready within four seconds.
  window.platformReady = true;
  const root = document.documentElement;
  root.classList.replace("no-js", "js");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The hero: the hall stays dark for a moment, its lights come up, and the
  // layout is drawn onto the floor. A scene switch redraws the other layout.
  const hall = document.querySelector(".hall");
  if (hall !== null) {
    const show = (scene, start) => {
      const groups = hall.querySelectorAll(".hall-ink .ink");
      groups.forEach((group) => group.classList.remove("is-on"));
      hall.style.setProperty("--start", `${String(start)}ms`);
      void hall.offsetWidth;
      groups.forEach((group) => { if (group.dataset.scene === scene) group.classList.add("is-on"); });
      hall.dataset.scene = scene;
      hall.querySelectorAll(".hall__drawn").forEach((line) => { line.hidden = line.dataset.for !== scene; });
    };
    let lit = false;
    const light = () => {
      if (lit) return;
      lit = true;
      hall.classList.add("is-lit");
      show("breakfast", still ? 0 : 1100);
      window.setTimeout(() => hall.classList.add("is-inked"), still ? 0 : 3300);
    };
    const photo = hall.querySelector(".hall__photo");
    if (photo === null || (photo.complete && photo.naturalWidth > 0)) light();
    else {
      photo.addEventListener("load", light, { once: true });
      photo.addEventListener("error", light, { once: true });
      window.setTimeout(light, 2500);
    }

    const radios = [...hall.querySelectorAll('.scenes [role="radio"]')];
    const choose = (radio, focus) => {
      radios.forEach((other) => {
        const on = other === radio;
        other.setAttribute("aria-checked", String(on));
        other.tabIndex = on ? 0 : -1;
      });
      if (focus) radio.focus();
      hall.classList.remove("is-inked");
      show(radio.dataset.scene, still ? 0 : 60);
      window.setTimeout(() => hall.classList.add("is-inked"), still ? 0 : 1900);
    };
    radios.forEach((radio, index) => {
      radio.addEventListener("click", () => choose(radio, false));
      radio.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        choose(radios[(index + step + radios.length) % radios.length], true);
      });
    });
  }

  // The story: on wide screens one frame holds each step's screen, changing
  // when the step's heading crosses the middle of the window.
  const stage = document.querySelector("[data-stage]");
  const steps = [...document.querySelectorAll(".step")];
  const wide = matchMedia("(min-width: 1000px)");
  if (stage !== null && steps.length > 0) {
    const shots = steps.map((step) => {
      const shot = document.createElement("div");
      shot.className = "stage__shot";
      const night = step.querySelector(".night");
      const picture = night ?? step.querySelector(".shot picture");
      if (step.querySelector(".shot--phone") !== null) shot.classList.add("stage__shot--phone");
      if (picture !== null) {
        const copy = picture.cloneNode(true);
        copy.querySelectorAll("img").forEach((image) => { image.alt = ""; image.loading = "lazy"; });
        copy.querySelectorAll("source, img").forEach((element) => {
          if (element.hasAttribute("sizes")) element.setAttribute("sizes", "(min-width: 1000px) 56vw, 92vw");
        });
        shot.append(copy);
      }
      stage.append(shot);
      return shot;
    });
    let current = -1;
    const select = (index) => {
      if (index < 0 || index === current) return;
      current = index;
      shots.forEach((shot, at) => shot.classList.toggle("is-current", at === index));
      for (const ahead of [index, index + 1, index + 2]) {
        shots[ahead]?.querySelectorAll("img").forEach((image) => { image.loading = "eager"; });
      }
      const full = steps[index].querySelector("[data-full]");
      stage.dataset.full = full?.dataset.full ?? "";
      stage.disabled = full === null;
      stage.setAttribute("aria-label", full === null
        ? `Screen for: ${steps[index].querySelector("h3")?.textContent ?? ""}`
        : full.getAttribute("aria-label") ?? "Enlarge the current screen");
    };
    // The current step is the last whose heading has passed the middle of the
    // window, read once a frame while scrolling, so a jump lands correctly too.
    const headings = steps.map((step) => step.querySelector("h3"));
    let pending = false;
    const update = () => {
      pending = false;
      const middle = window.innerHeight / 2;
      let index = 0;
      headings.forEach((heading, at) => { if (heading !== null && heading.getBoundingClientRect().top < middle) index = at; });
      select(index);
    };
    const schedule = () => { if (!pending) { pending = true; window.requestAnimationFrame(update); } };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    // On wide screens the inline screens are kept for screen readers only.
    const inline = () => document.querySelectorAll(".step .shot__open").forEach((button) => { button.tabIndex = wide.matches ? -1 : 0; });
    inline();
    wide.addEventListener("change", inline);
  }

  // The enlarged view: a native dialog with the whole capture.
  const viewer = document.querySelector(".viewer");
  const enlarged = viewer?.querySelector(".viewer__img");
  if (viewer !== null && enlarged !== null && enlarged !== undefined && typeof viewer.showModal === "function") {
    document.addEventListener("click", (event) => {
      const opener = event.target instanceof Element ? event.target.closest("[data-full]") : null;
      if (opener === null || opener.disabled || opener.dataset.full === "") return;
      enlarged.src = opener.dataset.full;
      enlarged.alt = (opener.getAttribute("aria-label") ?? "").replace(/^Enlarge: /u, "");
      viewer.showModal();
    });
    viewer.addEventListener("click", (event) => { if (event.target === viewer) viewer.close(); });
  }

  // The Claude cases: tabs, with the arrow keys, Home and End.
  const tabs = [...document.querySelectorAll('.cases [role="tab"]')];
  const pick = (tab, focus) => {
    tabs.forEach((other) => {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      other.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls") ?? "");
      if (panel !== null) panel.hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => pick(tab, false));
    tab.addEventListener("keydown", (event) => {
      const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      pick(tabs[(to + tabs.length) % tabs.length], true);
    });
  });
})();
