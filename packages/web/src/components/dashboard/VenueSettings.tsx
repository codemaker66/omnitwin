import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import * as spacesApi from "../../api/spaces.js";
import type { VenueDetail } from "../../api/spaces.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useToastStore } from "../../stores/toast-store.js";
import { ActivityIndicator } from "../shared/Activity.js";
import { ChangeoverSettings } from "./changeovers/ChangeoverSettings.js";
import { markInitials, markInk } from "./venue-mark.js";
import "./VenueSettings.css";

type LoadState = "loading" | "loaded" | "error";

const DEFAULT_BRAND_COLOUR = "#c98a5b";
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
  // The mark shows only a colour the venue could save: an unfinished code keeps the last good one.
  const markColour = brandColourIsValid && brandColour.trim().length > 0 ? brandColour.trim() : DEFAULT_BRAND_COLOUR;

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
      <section className="venue-settings" aria-labelledby="venue-settings-title">
        <div className="venue-settings__sheet venue-settings__state" data-register="ivory" role="status" aria-live="polite">
          <h2 id="venue-settings-title"><ActivityIndicator size={24} /> Loading venue settings</h2>
        </div>
      </section>
    );
  }

  if (venueId === null) {
    return (
      <section className="venue-settings" aria-labelledby="venue-settings-title">
        <div className="venue-settings__sheet venue-settings__state" data-register="ivory" role="status">
          <h2 id="venue-settings-title">No venue assigned</h2>
          <p>Ask an admin to assign your account to a venue.</p>
        </div>
      </section>
    );
  }

  if (loadState === "error" || venue === null) {
    return (
      <section className="venue-settings" aria-labelledby="venue-settings-title">
        <div className="venue-settings__sheet venue-settings__state" data-register="ivory" role="alert">
          <h2 id="venue-settings-title">Venue settings did not load</h2>
          <p>{loadError ?? "Venue settings could not be loaded."}</p>
          <button type="button" className="venue-settings__primary" onClick={() => { void loadVenue(); }}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="venue-settings" aria-labelledby="venue-settings-title">
      <div className="venue-settings__sheet" data-register="ivory">
        <header className="venue-settings__head">
          <div>
            <h2 id="venue-settings-title">Venue settings</h2>
            <p>The name and address people see across Venviewer.</p>
          </div>
          <p className="venue-settings__status" data-state={isDirty ? "dirty" : "clean"} role="status" aria-live="polite">
            {isDirty ? "Unsaved changes" : "Saved"}
          </p>
        </header>

        <div className="venue-settings__grid">
          <form
            className="venue-settings__form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <label className="venue-settings__field" htmlFor="venue-settings-name">
              <span>Venue name</span>
              <input
                id="venue-settings-name"
                type="text"
                value={name}
                onChange={(event) => { setName(event.target.value); }}
                autoComplete="organization"
                required
              />
            </label>

            <label className="venue-settings__field" htmlFor="venue-settings-address">
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

            <div className="venue-settings__split">
              <div className="venue-settings__field">
                <span id="venue-settings-brand-colour-label">Brand colour</span>
                <div className="venue-settings__colour">
                  <input
                    aria-label="Pick a colour"
                    type="color"
                    value={markColour}
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
                    aria-describedby={brandColourIsValid ? undefined : "venue-settings-brand-colour-error"}
                  />
                </div>
                {!brandColourIsValid ? (
                  <span id="venue-settings-brand-colour-error" className="venue-settings__error">
                    Use a six-digit colour code, like #c98a5b.
                  </span>
                ) : null}
              </div>

              <label className="venue-settings__field" htmlFor="venue-settings-logo-url">
                <span>Logo link</span>
                <input
                  id="venue-settings-logo-url"
                  type="url"
                  value={logoUrl}
                  onChange={(event) => { setLogoUrl(event.target.value); }}
                  aria-invalid={!logoUrlIsValid}
                  aria-describedby={logoUrlIsValid ? undefined : "venue-settings-logo-url-error"}
                />
                {!logoUrlIsValid ? (
                  <span id="venue-settings-logo-url-error" className="venue-settings__error">
                    Use a full link, starting https://
                  </span>
                ) : null}
              </label>
            </div>

            {saveError !== null ? <p className="venue-settings__alert" role="alert">{saveError}</p> : null}

            <div className="venue-settings__actions">
              <button
                type="button"
                className="venue-settings__quiet"
                disabled={!isDirty || saving}
                onClick={handleReset}
              >
                Undo changes
              </button>
              <button type="submit" className="venue-settings__primary" disabled={!canSave}>
                {saving ? <ActivityIndicator size={16} /> : null}
                {saving ? "Saving" : "Save changes"}
              </button>
            </div>
          </form>

          <aside className="venue-settings__preview" aria-label="Preview">
            <div className="venue-settings__card">
              <p className="venue-settings__kicker">Preview</p>
              <div className="venue-settings__mark" data-ink={markInk(markColour)} style={{ background: markColour }}>
                {logoUrl.trim().length > 0 && logoUrlIsValid ? (
                  <img src={logoUrl.trim()} alt="Venue logo preview" />
                ) : (
                  <span aria-hidden="true">{markInitials(name || venue.name)}</span>
                )}
              </div>
              <h3>{name.trim() || venue.name}</h3>
              <p>{address.trim() || venue.address}</p>
            </div>

            <dl className="venue-settings__meta">
              <div>
                <dt>Name in web links</dt>
                <dd>{venue.slug}</dd>
              </div>
              <div>
                <dt>Rooms</dt>
                <dd>{venue.spaces.length}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>

      <ChangeoverSettings venueId={venueId} />
    </section>
  );
}
