import atelier from "./assets/atelier.webp";
import mobileAtelier from "./assets/atelier-mobile.webp";
import type { VoiceId, Note } from "./contracts";
export const voices: { id: VoiceId; name: string; en: string }[] = [
  { id: "piano", name: "钢琴", en: "Pianoforte" },
  { id: "harp", name: "竖琴", en: "Harp" },
  { id: "cello", name: "大提琴", en: "Violoncello" },
  { id: "marimba", name: "马林巴", en: "Marimba" },
];
type Point = [number, number];
const layouts = {
  desktop: {
    width: 1448,
    height: 1086,
    piano:
      "M214 582L270 492 405 478 660 210 802 210 775 262Q940 340 821 468L880 502 874 555 841 640 839 776 807 783 785 668 656 692 641 928 592 934 574 730 418 676 412 844 373 839 340 668 214 625Z",
    harp: "M888 115Q941 101 979 146L1047 286Q1074 330 1126 289Q1181 268 1180 316L1119 694 1020 713 968 661 909 543Z",
    cello:
      "M870 393L905 393 930 535Q999 525 1001 605L978 640 1027 750Q1046 803 1000 829L1037 851 1028 882 818 853 830 828 834 773 864 673 848 610Q828 560 869 539L881 533Z",
    marimba:
      "M27 370L465 346 473 381 453 402 442 473 399 480 301 495 282 544 248 546 215 516 159 526 155 564 119 565 103 534 44 550Z",
    plant:
      "M1164 0H1448V820L1315 808 1285 670 1316 603 1288 540 1215 591 1138 512 1002 482 1022 414 1133 349 1048 224 1011 89 1008 0Z",
    keys: [
      [239, 591],
      [510, 657],
    ] as Point[],
    keyDepth: [0, 11] as Point,
    strings: [
      [949, 175],
      [1131, 324],
      [977, 655],
      [1078, 425],
    ] as Point[],
    bow: [
      [849, 705],
      [1040, 666],
    ] as Point[],
    mallets: [
      [334, 350],
      [370, 348],
    ] as Point[],
  },
  mobile: {
    width: 1086,
    height: 1448,
    piano:
      "M174 842L224 764 321 744 573 491 691 491 675 536Q780 586 725 683L677 733 737 756 739 827 702 896 692 1057 656 1070 632 927 537 982 541 1181 500 1184 473 1020 355 963 349 1092 312 1100 279 955 174 882Z",
    harp: "M715 357Q767 335 811 392L877 493Q901 531 943 500Q981 488 980 529L939 914 857 943 804 903 754 781Z",
    cello:
      "M744 676L773 679 802 810Q856 792 862 865L849 907 897 1020Q918 1064 877 1091L912 1116 906 1154 703 1125 710 1101 718 1028 742 934 727 889Q713 842 748 824L762 817Z",
    marimba:
      "M44 617L411 594 415 623 389 642 388 715 332 730 279 758 253 765 219 741 145 761 134 794 108 798 99 770 54 784Z",
    plant:
      "M713 0H1086V949L987 943 957 806 989 745 962 670 890 718 836 665 930 580 996 519 978 466 918 470 856 388 872 331 809 351 654 307 606 243 680 185 647 112Z",
    keys: [
      [193, 848],
      [429, 928],
    ] as Point[],
    keyDepth: [0, 10] as Point,
    strings: [
      [762, 416],
      [940, 548],
      [795, 896],
      [893, 665],
    ] as Point[],
    bow: [
      [725, 992],
      [908, 948],
    ] as Point[],
    mallets: [
      [315, 596],
      [338, 594],
    ] as Point[],
  },
};
export function deskArtwork() {
  return `<picture class="atelier"><source media="(max-width:700px)" srcset="${mobileAtelier}"/><img src="${atelier}" alt="阳光照进白色琴房。钢琴旁睡着一只猫，四件乐器依着窗与橄榄树，共处在同一片光里。" draggable="false"/></picture>
 <svg class="scene-controls" aria-label="可演奏的琴房" preserveAspectRatio="xMidYMid meet"><g id="plant" role="button" tabindex="0" aria-label="听叶间的风" aria-pressed="false"><path class="hit-shape" data-hit="plant"/></g>${voices.map((v) => `<g class="instrument-place ${v.id}" data-place="${v.id}"><g class="instrument" role="button" tabindex="0" data-instrument="${v.id}" aria-label="试听${v.name}当前页"><path class="hit-shape" data-hit="${v.id}"/></g><g class="playing-detail" aria-hidden="true"></g></g>`).join("")}</svg>
 <div class="instrument-panels">${voices.map((v) => `<div class="instrument-caption" data-caption="${v.id}"><span class="instrument-name">${v.en}</span><button class="voice-toggle" data-toggle="${v.id}" aria-label="${v.name}加入这一页" aria-pressed="true"><i aria-hidden="true"></i><span>在场</span></button></div>`).join("")}<span class="wind-caption">叶间的风</span></div>`;
}
const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
export function setSceneLayout(stage: HTMLElement, mobile: boolean) {
  const l = layouts[mobile ? "mobile" : "desktop"];
  stage
    .querySelector("svg")!
    .setAttribute("viewBox", `0 0 ${l.width} ${l.height}`);
  for (const v of [...voices.map((v) => v.id), "plant"] as const)
    stage.querySelector(`[data-hit="${v}"]`)!.setAttribute("d", l[v]);
  for (const v of voices) {
    let detail = "";
    if (v.id === "piano")
      detail = Array.from({ length: 28 }, (_, i) => {
        const p = lerp(l.keys[0]!, l.keys[1]!, i / 27);
        return `<path data-tone="${i}" d="M${p[0]} ${p[1]}l${l.keyDepth.join(" ")}"/>`;
      }).join("");
    else if (v.id === "harp")
      detail = Array.from({ length: 18 }, (_, i) => {
        const a = lerp(l.strings[0]!, l.strings[1]!, i / 17),
          b = lerp(l.strings[2]!, l.strings[3]!, i / 17);
        return `<path data-tone="${i}" d="M${a.join(" ")}L${b.join(" ")}"/>`;
      }).join("");
    else if (v.id === "cello")
      detail = `<g data-bow><path d="M${l.bow[0]!.join(" ")}L${l.bow[1]!.join(" ")}"/><path class="bow-hair" d="M${l.bow[0]![0] + 3} ${l.bow[0]![1] + 4}L${l.bow[1]![0] - 3} ${l.bow[1]![1] + 4}"/></g>`;
    else
      detail = l.mallets
        .map(
          (p, i) =>
            `<g data-mallet="${i}" style="transform-origin:${p[0]}px ${p[1] + 30}px"><path d="M${p[0] + (i ? -14 : 14)} ${p[1] + 36}L${p.join(" ")}"/><ellipse cx="${p[0]}" cy="${p[1]}" rx="5" ry="4"/></g>`,
        )
        .join("");
    stage.querySelector(`[data-place="${v.id}"] .playing-detail`)!.innerHTML =
      detail;
  }
}
/** Bounded engraved details follow authored note onsets; nothing is randomly animated. */
export function instrumentMotion(
  place: Element,
  voice: VoiceId,
  notes: Note[],
  beat: number,
) {
  const active = notes.filter((n) => beat >= n.at && beat < n.at + n.duration);
  const energy = (n: Note) =>
    Math.exp(-(beat - n.at) / (voice === "cello" ? 2 : 0.28)) *
    n.velocity *
    1.5;
  if (voice === "piano" || voice === "harp") {
    const count = voice === "piano" ? 28 : 18,
      values = Array.from({ length: count }, () => 0);
    for (const n of active) {
      const index = Math.max(
        0,
        Math.min(
          count - 1,
          Math.round(
            (n.midi - (voice === "piano" ? 50 : 38)) /
              (voice === "piano" ? 1.5 : 2.2),
          ),
        ),
      );
      values[index] = Math.max(values[index]!, energy(n));
    }
    place
      .querySelectorAll<SVGElement>("[data-tone]")
      .forEach((line, i) =>
        line.style.setProperty("--note", String(values[i])),
      );
  } else if (voice === "cello") {
    const bow = place.querySelector<SVGElement>("[data-bow]")!,
      last = active[0];
    bow.style.setProperty(
      "--bow",
      last ? String(Math.sin((beat - last.at) * 2.5) * 7) : "0",
    );
    bow.style.opacity = last ? "0.68" : "0";
  } else
    place.querySelectorAll<SVGElement>("[data-mallet]").forEach((mallet, i) => {
      const n = active.find((n) => Math.round(n.at * 2) % 2 === i);
      mallet.style.setProperty("--strike", String(n ? energy(n) : 0));
    });
}
