export function seedArt(id: string) {
  const themes: Record<string, [string, string, string, string]> = {
    'quiet-city': ['#a1b8b0', '#385349', '#e7e5d7', 'city'],
    'light-form': ['#df9f79', '#ac5946', '#f3d2b7', 'forms'],
    'northern-coast': ['#a6bdca', '#3a586c', '#e6e7db', 'landscape'],
    botanical: ['#b6b493', '#485a43', '#e2dcca', 'plant'],
    'type-study': ['#ca8373', '#6c3536', '#f4d0a8', 'type'],
    'still-life': ['#c9b3a0', '#5b5450', '#ece4d3', 'forms'],
    landscape: ['#999db2', '#484d6c', '#d7c8c4', 'landscape'],
    'visual-system': ['#c3ba8f', '#5f6143', '#e8e4ce', 'type'],
  };
  const [bg, dark, light, kind] = themes[id] || themes['light-form'];
  const pieces: Record<string, string> = {
    city: `<path d="M0 430H800V600H0z" fill="${dark}"/><path d="M90 430V205h120v225m45 0V130h145v300m35 0V250h110v180m45 0V100h120v330" fill="${light}"/><path d="M115 240h65m100-70h90m90 115h60m95-145h70" stroke="${dark}" stroke-width="16"/><circle cx="140" cy="110" r="50" fill="${light}"/><path d="M300 600l90-170h80l95 170" fill="${bg}"/>`,
    forms: `<ellipse cx="420" cy="470" rx="220" ry="35" fill="${dark}" opacity=".3"/><circle cx="300" cy="290" r="135" fill="${light}"/><path d="M390 200l180 45v220l-180-45z" fill="${dark}"/><path d="M390 200l100-65 180 45-100 65z" fill="${light}"/><path d="M570 245l100-65v220l-100 65z" fill="${dark}" opacity=".6"/>`,
    landscape: `<circle cx="570" cy="140" r="80" fill="${light}"/><path d="M0 390Q140 170 310 330T800 280V600H0" fill="${dark}" opacity=".6"/><path d="M0 450Q240 230 440 420T800 340V600H0" fill="${dark}"/><path d="M0 510Q180 430 400 510T800 470V600H0" fill="${light}" opacity=".7"/>`,
    plant: `<path d="M400 530V130m0 280Q180 420 180 245q200-20 220 165m0-100q220 0 220-180-200-20-220 180m0 180q190 0 190-140-180-10-190 140" fill="${dark}" stroke="${dark}" stroke-width="7"/><circle cx="210" cy="120" r="38" fill="${light}"/>`,
    type: `<path d="M100 450L260 120h80l160 330H390l-90-205-95 205z" fill="${dark}"/><circle cx="600" cy="200" r="85" fill="${light}"/><path d="M540 330h140v120H540z" fill="${dark}"/><path d="M100 500h580" stroke="${light}" stroke-width="5"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="${bg}"/>${pieces[kind]}</svg>`;
}
