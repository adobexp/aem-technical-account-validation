import { useTheme } from "../theme/ThemeProvider.jsx";

const MODES = [
  { id: "auto", label: "AUTO" },
  { id: "light", label: "LIGHT" },
  { id: "dark", label: "DARK" },
];

export default function Header() {
  const { mode, setMode } = useTheme();

  return (
    <header className="header" data-component="header">
      <div className="header__logo">
        <img
          className="header__logo-img header__logo-img--dark"
          src="/images/AdobeXPLogo/AdobeXPLogoMinified-DARK.png"
          alt="AdobeXP"
        />
        <img
          className="header__logo-img header__logo-img--light"
          src="/images/AdobeXPLogo/AdobeXPLogoMinified-LIGHT.png"
          alt="AdobeXP"
        />
        <div className="header__titles">
          <h1 className="header__title">AEM Technical Account Validation</h1>
          <p className="header__subtitle">CRUD permission check for AEMaaCS integrations</p>
        </div>
      </div>
      <div className="header__theme" role="radiogroup" aria-label="Theme">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`header__theme-btn${mode === item.id ? " is-active" : ""}`}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
}
