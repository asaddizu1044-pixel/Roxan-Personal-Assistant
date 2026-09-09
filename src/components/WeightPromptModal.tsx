import { useState } from "react";
import { Scale, X } from "lucide-react";

interface WeightPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (weight: number) => void;
  calories: number | null;
  steps: number;
  distance: number;
}

export default function WeightPromptModal({
  isOpen,
  onClose,
  onSave,
  calories,
  steps,
  distance,
}: WeightPromptModalProps) {
  const [weight, setWeight] = useState<number>(70);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("📤 Weight submitted:", weight);
    if (weight > 0) {
      onSave(weight);
      onClose();
    }
  };

  // Estimate calories with weight
  const estimatedCalories = (calories || 0) * (weight / 70);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="weight-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">
          <div className="weight-icon"><Scale size={28} /></div>
          <h2 id="weight-modal-title">🏃 You burned some calories!</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="weight-summary">
          <div className="stat">
            <span className="label">Steps</span>
            <span className="value">{steps.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="label">Distance</span>
            <span className="value">{(distance / 1000).toFixed(2)} km</span>
          </div>
          <div className="stat">
            <span className="label">Est. Calories</span>
            <span className="value">{estimatedCalories.toFixed(0)} kcal</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="weight-form">
          <p className="weight-description">
            Enter your weight for more accurate calorie calculation
          </p>
          <div className="weight-input-group">
            <label>
              Your weight (kg)
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                min={30}
                max={250}
                step={0.5}
                required
                autoFocus
              />
            </label>
            <span className="weight-unit">kg</span>
          </div>
          <button type="submit" className="modal-submit">
            Calculate Calories 🔥
          </button>
        </form>
      </div>
    </div>
  );
}