import { useEffect, useId, useState, type FormEvent } from "react";
import { Scale } from "lucide-react";

interface WeightPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (weightKg: number) => void;
  /** Base active-calorie estimate calculated at the reference weight. */
  calories: number | null;
  steps: number;
  /** Distance in metres. */
  distance: number;
}

const REFERENCE_WEIGHT_KG = 70;
const MIN_WEIGHT_KG = 30;
const MAX_WEIGHT_KG = 250;

export default function WeightPromptModal({
  isOpen,
  onClose,
  onSave,
  calories,
  steps,
  distance,
}: WeightPromptModalProps) {
  const [weightInput, setWeightInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    setWeightInput("");
    setError(null);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const weightKg = Number(weightInput);
  const hasValidWeight = Number.isFinite(weightKg) && weightKg >= MIN_WEIGHT_KG && weightKg <= MAX_WEIGHT_KG;
  const hasCalories = Number.isFinite(calories) && calories !== null;
  const estimatedCalories = hasCalories && hasValidWeight
    ? calories * (weightKg / REFERENCE_WEIGHT_KG)
    : null;

  const safeSteps = Number.isFinite(steps) && steps >= 0 ? steps : 0;
  const safeDistanceKm = Number.isFinite(distance) && distance >= 0 ? distance / 1000 : 0;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasValidWeight) {
      setError(`Enter a weight between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG} kg.`);
      return;
    }

    onSave(weightKg);
    onClose();
  };

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="weight-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div className="weight-icon" aria-hidden="true">
            <Scale size={28} />
          </div>
          <div>
            <p className="eyebrow">PERSONALIZE YOUR ESTIMATE</p>
            <h2 id={titleId}>
              {hasCalories ? "Refine your calorie estimate" : "Add your weight"}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close weight dialog"
          >
            ×
          </button>
        </div>

        <div className="weight-summary" aria-label="Session summary">
          <div className="stat">
            <span className="label">Steps</span>
            <span className="value">{safeSteps.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="label">Distance</span>
            <span className="value">{safeDistanceKm.toFixed(2)} km</span>
          </div>
          <div className="stat">
            <span className="label">Est. calories</span>
            <span className="value">{estimatedCalories === null ? "—" : `${estimatedCalories.toFixed(0)} kcal`}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="weight-form" noValidate>
          <p className="weight-description">
            {hasCalories
              ? "Enter your weight to personalize this session estimate."
              : "Enter your weight. A calorie estimate will appear after activity data is available."}
          </p>

          <div className="weight-input-group">
            <label htmlFor="session-weight">Your weight (kg)</label>
            <div className="weight-input-control">
              <input
                id="session-weight"
                name="weightKg"
                type="number"
                value={weightInput}
                onChange={(event) => {
                  setWeightInput(event.target.value);
                  setError(null);
                }}
                min={MIN_WEIGHT_KG}
                max={MAX_WEIGHT_KG}
                step={0.1}
                inputMode="decimal"
                placeholder="e.g. 68.5"
                autoFocus
                aria-invalid={error !== null}
                aria-describedby={error ? "weight-error" : undefined}
              />
              <span className="weight-unit" aria-hidden="true">kg</span>
            </div>
            {error && <span id="weight-error" className="form-error" role="alert">{error}</span>}
          </div>

          <button type="submit" className="modal-submit">
            Save weight and calculate
          </button>
        </form>
      </section>
    </div>
  );
}

