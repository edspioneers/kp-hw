import { getConfig } from '../ak.js';

const { codeBase } = getConfig();
const cache = {};

async function fetchIcon(name) {
  if (cache[name] !== undefined) return cache[name];
  try {
    const resp = await fetch(`${codeBase}/img/icons/${name}.svg`);
    if (!resp.ok) {
      cache[name] = null;
      return null;
    }
    const text = await resp.text();
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    const el = tmp.querySelector('svg');
    if (!el) {
      cache[name] = null;
      return null;
    }
    cache[name] = {
      viewBox: el.getAttribute('viewBox') || '0 0 24 24',
      innerHTML: el.innerHTML,
    };
  } catch {
    cache[name] = null;
  }
  return cache[name];
}

export default async function loadIcons(icons) {
  await Promise.all([...icons].map(async (icon) => {
    const name = icon.classList[1].substring(5);
    const data = await fetchIcon(name);
    if (!data) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', icon.className);
    svg.setAttribute('viewBox', data.viewBox);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = data.innerHTML;
    icon.replaceWith(svg);
  }));
}
