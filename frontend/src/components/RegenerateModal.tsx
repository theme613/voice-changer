/**
 * RegenerateModal.tsx — Regeneration Options Modal
 *
 * Appears when the user clicks "Regenerate" on the preview screen.
 * Lets them choose a different model, strength, and noise reduction option.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';
import Tooltip from './Tooltip';

interface RegenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegenerate: (settings: RegenerateSettings) => void;
  isProcessing: boolean;
}

export interface RegenerateSettings {
  model: string;
  strength: string;
  applyNoiseReduction: boolean;
}

const MODELS = [
  {
    id: 'Fast',
    label: 'Fast',
    desc: 'Faster processing — good for clean recordings (MDX-Net)',
  },
  {
    id: 'Balanced',
    label: 'Balanced',
    desc: 'Best overall quality — recommended for most videos (Demucs v4)',
  },
  {
    id: 'Strong',
    label: 'Strong',
    desc: 'Latest AI model & noise reduction — best for music-heavy audio (BS-Roformer)',
  },
];

export default function RegenerateModal({
  isOpen,
  onClose,
  onRegenerate,
  isProcessing,
}: RegenerateModalProps) {
  const [model, setModel] = useState('Balanced');

  const handleSubmit = () => {
    onRegenerate({
      model,
      strength: model === 'Strong' ? 'strong' : 'normal',
      applyNoiseReduction: model === 'Strong',
    });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isProcessing) onClose();
          }}
        >
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header */}
            <div className="modal-header">
              <h2 className="modal-title">Re-process Vocals</h2>
              <button
                className="modal-close"
                onClick={onClose}
                disabled={isProcessing}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Model Selection */}
            <div className="form-group">
              <label className="form-label">
                Cleaning Level
                <Tooltip text="Different AI models and settings work better on different types of audio. Try another if the result wasn't clean." />
              </label>
              <div className="radio-group">
                {MODELS.map((m) => (
                  <label
                    key={m.id}
                    className={`radio-option ${model === m.id ? 'selected' : ''}`}
                    onClick={() => setModel(m.id)}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.id}
                      checked={model === m.id}
                      onChange={() => setModel(m.id)}
                    />
                    <div>
                      <div className="radio-option-label">{m.label}</div>
                      <div className="radio-option-desc">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Submit Button */}
            <button
              className="btn btn-primary btn-lg w-full mt-4"
              onClick={handleSubmit}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  Processing...
                </>
              ) : (
                <>
                  <RefreshCw size={18} />
                  Re-process Vocals
                </>
              )}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
