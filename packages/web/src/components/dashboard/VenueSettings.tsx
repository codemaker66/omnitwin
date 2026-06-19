import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { BadgeCheck, RotateCcw, Save, ShieldAlert } from "lucide-react";
import * as spacesApi from "../../api/spaces.js";
import type { VenueDetail } from "../../api/spaces.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import "./VenueSettings.css";

type LoadState = "loading" | "loaded" | "error";

const DEFAULT_BRAND_COLOUR = "#c9a96a";
const HEX_COLOUR_PATTERN = /^#[0-9a-fA-F]{6}$/u;

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validLogoUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function venueFormChanged(
  venue: VenueDetail | null,
  name: string,
  address: string,
  brandColour: string,
  logoUrl: string,
): boolean {
  if (venue === null) return false;
  return name.trim() !== venue.name ||
    address.trim() !== venue.address ||
    optionalText(brandColour) !== venue.brandColour ||
    optionalText(logoUrl) !== venue.logoUrl;
}

export function VenueSettings(): ReactElement {
  const venueId = useAuthStore((state) => state.user?.venueId) ?? null;
  const addToast = useToastStore((state) => state.addToast);

  const [venue, setVenue] = useState<VenueDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [brandColour, setBrandColour] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  const hydrateForm = useCallback((data: VenueDetail): void => {
    setVenue(data);
    setName(data.name);
    setAddress(data.address);
    setBrandColour(data.brandColour ?? "");
    setLogoUrl(data.logoUrl ?? "");
  }, []);

  const loadVenue = useCallback(async (): Promise<void> => {
    setSaveError(null);
    if (venueId === null) {
      setVenue(null);
      setLoadState("loaded");
      setLoadError(null);
      return;
    }

    setLoadState("loading");
    setLoadError(null);
    try {
      const data = await spacesApi.getVenue(venueId);
      hydrateForm(data);
      setLoadState("loaded");
    } catch (error: unknown) {
      setVenue(null);
      setLoadState("error");
      setLoadError(error instanceof Error ? error.message : "Venue settings could not be loaded.");
      addToast("Failed to load venue settings", "error");
    }
  }, [addToast, hydrateForm, venueId]);

  useEffect(() => {
    void loadVenue();
  }, [loadVenue]);

  const isDirty = useMemo(
    () => venueFormChanged(venue, name, address, brandColour, logoUrl),
    [address, brandColour, logoUrl, name, venue],
  );

  const brandColourIsValid = brandColour.trim().length === 0 || HEX_COLOUR_PATTERN.test(brandColour.trim());
  const logoUrlIsValid = validLogoUrl(logoUrl);
  const canSave = venueId !== null &&
    venue !== null &&
    !saving &&
    isDirty &&
    name.trim().length > 0 &&
    address.trim().length > 0 &&
    brandColourIsValid &&
    logoUrlIsValid;

  const handleReset = (): void => {
    if (venue === null) return;
    hydrateForm(venue);
    setSaveError(null);
  };

  const handleSave = async (): Promise<void> => {
    if (
      venueId === null ||
      venue === null ||
      saving ||
      !isDirty ||
      name.trim().length === 0 ||
      address.trim().length === 0 ||
      !brandColourIsValid ||
      !logoUrlIsValid
    ) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await spacesApi.updateVenue(venueId, {
        name: name.trim(),
        address: address.trim(),
        brandColour: optionalText(brandColour),
        logoUrl: optionalText(logoUrl),
      });
      hydrateForm({
        ...venue,
        name: updated.name,
        address: updated.address,
        brandColour: updated.brandColour,
        logoUrl: updated.logoUrl,
      });
      addToast("Venue settings saved", "success");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Venue settings could not be saved.";
      setSaveError(message);
      addToast("Failed to save venue settings", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loadState === "loading") {
    return (
      <section className="venue-settings-shell" aria-labelledby="venue-settings-title">
        <div className="venue-settings-state" role="status" aria-live="polite">
          <p className="venue-settings-kicker">Venue record</p>
          <h2 id="venue-settings-title">Loading venue settings</h2>
          <p>Opening the current venue record and room manifest.</p>
        </div>
      </section>
    );
  }

  if (venueId === null) {
    return (
      <section className="venue-settings-shell" aria-labelledby="venue-settings-title">
        <div className="venue-settings-state" role="status">
          <ShieldAlert size={24} aria-hidden="true" />
          <p className="venue-settings-kicker">Venue record</p>
          <h2 id="venue-settings-title">No venue assigned</h2>
          <p>Ask an admin to attach your account to a venue before editing public room details.</p>
        </div>
      </section>
    );
  }

  if (loadState === "error" || venue === null) {
    return (
      <section className="venue-settings-shell" aria-labelledby="venue-settings-title">
        <div className="venue-settings-state venue-settings-state--error" role="alert">
          <ShieldAlert size={24} aria-hidden="true" />
          <p className="venue-settings-kicker">Venue record</p>
          <h2 id="venue-settings-title">Venue settings unavailable</h2>
          <p>{loadError ?? "Venue settings could not be loaded."}</p>
          <button type="button" className="venue-settings-button" onClick={() => { void loadVenue(); }}>
            <RotateCcw size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="venue-settings-shell" aria-labelledby="venue-settings-title">
      <header className="venue-settings-header">
        <div>
          <p className="venue-settings-kicker">Venue record</p>
          <h2 id="venue-settings-title">Venue Settings</h2>
          <p>
            These fields drive staff dashboards, public room previews, proposal shells, and hallkeeper handoff headers.
          </p>
        </div>
        <div className="venue-settings-status" data-state={isDirty ? "dirty" : "clean"} role="status" aria-live="polite">
          <BadgeCheck size={18} aria-hidden="true" />
          {isDirty ? "Unsaved venue changes" : "Venue record in sync"}
        </div>
      </header>

      <div className="venue-settings-grid">
        <form
          className="venue-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <label className="venue-settings-field" htmlFor="venue-settings-name">
            <span>Venue Name</span>
            <input
              id="venue-settings-name"
              type="text"
              value={name}
              onChange={(event) => { setName(event.target.value); }}
              autoComplete="organization"
              required
            />
          </label>

          <label className="venue-settings-field" htmlFor="venue-settings-address">
            <span>Address</span>
            <input
              id="venue-settings-address"
              type="text"
              value={address}
              onChange={(event) => { setAddress(event.target.value); }}
              autoComplete="street-address"
              required
            />
          </label>

          <div className="venue-settings-split">
            <div className="venue-settings-field">
              <span id="venue-settings-brand-colour-label">Brand Colour</span>
              <div className="venue-settings-colour-row">
                <input
                  aria-label="Colour swatch"
                  type="color"
                  value={brandColourIsValid && brandColour.trim().length > 0 ? brandColour : DEFAULT_BRAND_COLOUR}
                  onChange={(event) => { setBrandColour(event.target.value); }}
                />
                <input
                  id="venue-settings-brand-colour"
                  type="text"
                  value={brandColour}
                  onChange={(event) => { setBrandColour(event.target.value); }}
                  placeholder={DEFAULT_BRAND_COLOUR}
                  maxLength={7}
                  aria-labelledby="venue-settings-brand-colour-label"
                  aria-invalid={!brandColourIsValid}
                />
              </div>
              {!brandColourIsValid ? <span className="venue-settings-error">Use a six-digit hex colour, for example #c9a96a.</span> : null}
            </div>

            <label className="venue-settings-field" htmlFor="venue-settings-logo-url">
              <span>Logo URL</span>
              <input
                id="venue-settings-logo-url"
                type="url"
                value={logoUrl}
                onChange={(event) => { setLogoUrl(event.target.value); }}
                placeholder="https://example.com/logo.png"
                aria-invalid={!logoUrlIsValid}
              />
              {!logoUrlIsValid ? <span className="venue-settings-error">Use a valid http or https URL.</span> : null}
            </label>
          </div>

          {saveError !== null ? <p className="venue-settings-alert" role="alert">{saveError}</p> : null}

          <div className="venue-settings-actions">
            <button
              type="button"
              className="venue-settings-button venue-settings-button--secondary"
              disabled={!isDirty || saving}
              onClick={handleReset}
            >
              <RotateCcw size={16} aria-hidden="true" />
              Reset
            </button>
            <button type="submit" className="venue-settings-button" disabled={!canSave}>
              <Save size={16} aria-hidden="true" />
              {saving ? "Saving venue" : "Save Changes"}
            </button>
          </div>
        </form>

        <aside className="venue-settings-preview" aria-label="Venue record preview">
          <div className="venue-settings-preview-card" style={{ borderColor: optionalText(brandColour) ?? DEFAULT_BRAND_COLOUR }}>
            <div className="venue-settings-logo-preview" style={{ background: optionalText(brandColour) ?? DEFAULT_BRAND_COLOUR }}>
              {logoUrl.trim().length > 0 && logoUrlIsValid ? (
                <img src={logoUrl.trim()} alt="Venue logo preview" />
              ) : (
                <span>{name.trim().slice(0, 2).toUpperCase() || "VV"}</span>
              )}
            </div>
            <p className="venue-settings-kicker">Public identity preview</p>
            <h3>{name.trim() || venue.name}</h3>
            <p>{address.trim() || venue.address}</p>
          </div>

          <dl className="venue-settings-meta">
            <div>
              <dt>Slug</dt>
              <dd>{venue.slug}</dd>
            </div>
            <div>
              <dt>Room records</dt>
              <dd>{venue.spaces.length}</dd>
            </div>
            <div>
              <dt>Runtime exposure posture</dt>
              <dd>Public copy remains evidence-gated.</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
