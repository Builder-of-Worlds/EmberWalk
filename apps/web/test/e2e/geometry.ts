export const sideways = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;

export const offCentre = () => {
  const SLACK = 4;
  const centreOf = (el: Element) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const right = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    return (left + right) / 2;
  };
  const textCentre = (el: Element) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    return box.left + box.width / 2;
  };
  const shown = (el: Element) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden";
  const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const off: string[] = [];
  const main = document.querySelector("main");
  if (main === null) return ["no main"];
  for (const el of main.querySelectorAll("h1, h2, h3, h4, label, .label")) {
    if (!shown(el) || el.parentElement === null) continue;
    const by = Math.abs(textCentre(el) - centreOf(el.parentElement));
    if (by > SLACK) off.push(`${name(el)} off centre by ${Math.round(by)} px`);
  }
  const groups = new Set<Element>();
  for (const el of main.querySelectorAll("button, a.button")) {
    if (!shown(el) || el.parentElement === null) continue;
    groups.add(el.parentElement);
    const by = Math.abs(textCentre(el) - centreOf(el));
    if (by > SLACK) off.push(`${name(el)} text off centre by ${Math.round(by)} px`);
  }
  for (const parent of groups) {
    const boxes = [...parent.children].filter((c) => c.matches("button, a.button") && shown(c)).map((c) => c.getBoundingClientRect());
    const mid = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
    const by = Math.abs(mid - centreOf(parent));
    if (by > SLACK) off.push(`buttons in ${name(parent)} off centre by ${Math.round(by)} px`);
  }
  return off;
};
