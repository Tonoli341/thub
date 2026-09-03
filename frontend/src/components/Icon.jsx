// Set di icone condiviso (sidebar, e ovunque serva un'icona coerente con lo
// stile dell'app — es. il selettore icona delle categorie manutenzioni).
// Estratto da App.jsx per evitare che le pagine lazy-loaded debbano importare
// da App.jsx (che le importa a sua volta: ciclo da evitare).
//
// La maggior parte delle icone viene da react-icons (Tabler/Game Icons/Font
// Awesome/Material), verificate una per una nel pacchetto reale — non tutte
// le icone industriali richieste esistono in una libreria generalista: quelle
// senza corrispondenza (reach-truck, pallet-jack, shuttle-rack,
// trilateral-truck, jack) restano disegnate a mano in stile stroke coerente.

import { TbActivity, TbBeach, TbBox, TbBriefcase, TbCalendar, TbChecklist, TbChevronDown, TbClock, TbCode, TbFileText, TbFolder, TbHierarchy2, TbHome, TbLayoutSidebar, TbPlane, TbPlug, TbReceipt, TbSearch, TbSitemap, TbSun, TbTools, TbUser, TbUsers, TbUsersGroup, TbWorld } from "react-icons/tb";
import { GiCrane, GiFireExtinguisher, GiFlame, GiForklift, GiHook, GiPalmTree } from "react-icons/gi";
import { FaGraduationCap } from "react-icons/fa6";
import { MdFireHydrantAlt, MdPallet, MdShelves } from "react-icons/md";

export const ICON_NAMES = [
  "home", "briefcase", "calendar", "user", "users", "team", "orgchart", "folder",
  "document", "checklist", "box", "receipt", "search", "panel", "tree-palm",
  "beach-umbrella", "sun", "plane", "structure", "graduation", "code", "clock",
  "pulse", "planet", "plug", "tools", "forklift", "reach-truck", "pallet-jack",
  "shuttle-rack", "trilateral-truck", "fire-extinguisher", "flame", "pump-station",
  "shelving", "pallet", "crane", "hook", "jack", "hydrant", "telescopic-handler",
  "forklift-detailed",
];

const LIBRARY_ICONS = {
  home: TbHome,
  briefcase: TbBriefcase,
  calendar: TbCalendar,
  user: TbUser,
  users: TbUsers,
  team: TbUsersGroup,
  orgchart: TbSitemap,
  folder: TbFolder,
  document: TbFileText,
  checklist: TbChecklist,
  box: TbBox,
  receipt: TbReceipt,
  search: TbSearch,
  panel: TbLayoutSidebar,
  "chevron-down": TbChevronDown,
  "tree-palm": GiPalmTree,
  "beach-umbrella": TbBeach,
  sun: TbSun,
  plane: TbPlane,
  structure: TbHierarchy2,
  graduation: FaGraduationCap,
  code: TbCode,
  clock: TbClock,
  pulse: TbActivity,
  planet: TbWorld,
  plug: TbPlug,
  tools: TbTools,
  forklift: GiForklift,
  "fire-extinguisher": GiFireExtinguisher,
  flame: GiFlame,
  shelving: MdShelves,
  pallet: MdPallet,
  crane: GiCrane,
  hook: GiHook,
  hydrant: MdFireHydrantAlt,
};

export function Icon({ name, size = 20, stroke = 1.9 }) {
  const LibraryIcon = LIBRARY_ICONS[name];
  if (LibraryIcon) {
    return <LibraryIcon size={size} style={{ display: "block" }} />;
  }

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  switch (name) {
    case "forklift-detailed":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 612 612"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          stroke="currentColor"
          strokeWidth={stroke * 25.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="151" cy="397" r="52" />
          <circle cx="151" cy="397" r="25" />
          <circle cx="401" cy="397" r="52" />
          <circle cx="401" cy="397" r="25" />
          <path d="M203 421H354" />
          <path d="M193 344H165C153 344 144 353 144 365V373" />
          <path d="M193 306V421" />
          <path d="M194 246V306C194 336 207 369 224 397L239 421" />
          <path d="M194 246H312" />
          <path d="M194 246C194 236 202 228 212 228H310" />
          <path d="M309 228L324 239L338 277L355 322L340 358L313 390L282 420H239" />
          <path d="M310 228L352 198" />
          <path d="M338 277L372 257" />
          <path d="M355 322L380 343" />
          <path d="M223 322L223 344L251 368V399H280L306 373" />
          <path d="M251 344H289" />
          <path d="M326 330V350" />
          <path d="M384 303V324" />
          <path d="M352 198L357 182L370 175L405 231L389 237L372 257" />
          <path d="M370 175L384 187L404 174C415 167 428 163 436 165C447 168 455 181 451 193C449 200 443 205 435 211L405 231" />
          <path d="M451 193L466 211V253H530" />
          <path d="M435 211L435 258C435 270 445 279 457 278L545 268V254L530 253" />
        </svg>
      );
    case "reach-truck":
      return (
        <svg {...common}>
          <path d="M2 12.5h5.5" />
          <path d="M2 15.5h5.5" />
          <path d="M7.5 8v11.5" />
          <path d="M10 8v11.5" />
          <rect x="10" y="9" width="8" height="7" rx="1" />
          <circle cx="6" cy="20.8" r="1.4" />
          <circle cx="16" cy="20.8" r="1.4" />
        </svg>
      );
    case "pallet-jack":
      return (
        <svg {...common}>
          <path d="M2 15.5h9.5" />
          <path d="M2 18h9.5" />
          <path d="M11.5 15.5 19 5.5" />
          <path d="M16.5 7 21 4.3" />
          <circle cx="4.5" cy="19.8" r="1.4" />
          <circle cx="9" cy="19.8" r="1.4" />
        </svg>
      );
    case "shuttle-rack":
      return (
        <svg {...common}>
          <path d="M2 7.5h20" />
          <path d="M2 17.5h20" />
          <rect x="7.5" y="9.5" width="9" height="6" rx="1.5" />
          <path d="M10 12.5h4" />
        </svg>
      );
    case "trilateral-truck":
      return (
        <svg {...common}>
          <path d="M12.5 3v14" />
          <path d="M15 3v14" />
          <rect x="15" y="7.5" width="6" height="5" rx="1" />
          <path d="M6 9.5h6.5" />
          <path d="M6 12h6.5" />
          <circle cx="9" cy="20.3" r="1.4" />
          <circle cx="18" cy="20.3" r="1.4" />
        </svg>
      );
    case "pump-station":
      return (
        <svg {...common}>
          <path d="M2 8.5h5.5" />
          <path d="M7.5 8.5v3" />
          <path d="M7.5 11.5h4" />
          <circle cx="5" cy="8.5" r="1.3" />
          <path d="M4 15h3M4 18h3" />
          <path d="M13 11.5h3.5v-4H19" />
          <circle cx="19" cy="7.5" r="1.3" />
          <path d="M19 5v-1.5" />
          <rect x="14.5" y="14" width="8" height="4" rx="1" />
          <circle cx="16.5" cy="16" r="1.3" />
          <path d="M14.5 16h-3.5v-2.7" />
          <path d="M13 18v2.5h8V18" />
        </svg>
      );
    case "telescopic-handler":
      return (
        <svg {...common}>
          <path d="M3.2 12.5c0-2 1-3.6 2.7-4.3l3-1.2c.6-.2 1-.7 1.1-1.3" />
          <path d="M3.2 12.5v3.8h1.7" />
          <path d="M3.2 12.5H2.4" />
          <path d="M9.5 5c.8-.3 1.6 0 1.9.8" />
          <path d="M11.4 5.8c.7 1.1 1.7 1.9 3 2.3" />
          <path d="M14.4 8.1c.5.2.9.6 1.1 1.1" />
          <path d="M15.5 9.2c.3-.5.8-.9 1.4-1l6-1.4" />
          <path d="m21.5 6.5-.6 1.6-2.2.5" />
          <path d="M12.6 16.3c.3-2.9 1.6-5.4 3.9-7.1" />
          <path d="M4.9 16.3h7.7" />
          <circle cx="6.8" cy="18.3" r="2.1" />
          <circle cx="13.2" cy="18.3" r="2.1" />
        </svg>
      );
    case "jack":
      return (
        <svg {...common}>
          <path d="M4 21h6" />
          <path d="M7 21v-4.5" />
          <rect x="4.5" y="12" width="5" height="4.5" rx="1" />
          <path d="M7 12V8.5" />
          <path d="M4.5 8.5h5" />
          <path d="M7 8.5V4" />
          <path d="M5.2 4h3.6" />
        </svg>
      );
    default:
      return null;
  }
}
