import { useEffect, useRef, useState } from "react";
import { User, ArrowRight } from "lucide-react";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (name: string) => void;
  isLoading: boolean;
}

export default function LoginModal({ isOpen, onClose, onLogin, isLoading }: LoginModalProps) {
  const [name, setName] = useState("");
  
  // ✅ Ref for click outside detection
  const modalRef = useRef<HTMLDivElement>(null);

  // ✅ Click outside handler
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // ✅ Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onLogin(name.trim());
    }
  };

  return (
    <div className="modal-scrim">
      <div className="login-modal" ref={modalRef} role="dialog" aria-modal="true">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Welcome to</p>
            <h2 id="login-modal-title">Roxan Personal Assistant</h2>
          </div>
          <button 
            className="modal-close" 
            onClick={onClose} 
            aria-label="Close login"
            type="button"
          >
            ×
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-avatar">
            <User size={48} />
          </div>
          
          <p className="login-description">
            Enter your name to start tracking your activity
          </p>
          
          <label>
            Your Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              required
              autoFocus
              disabled={isLoading}
            />
          </label>
          
          <button 
            type="submit" 
            className="modal-submit" 
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Continue"} 
            <ArrowRight size={15} />
          </button>
          
          <small className="login-note">
            Your data is private and stored securely in the cloud.
          </small>
        </form>
      </div>
    </div>
  );
}