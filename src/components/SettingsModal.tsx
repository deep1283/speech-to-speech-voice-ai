'use client';

import React from 'react';
import { X, Server, Mic, Radio, Sliders } from 'lucide-react';

export interface AppConfig {
  wsUrl: string;
  sampleRate: number;
  format: 'int16' | 'float32';
  talkMode: 'continuous' | 'pushtotalk';
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AppConfig;
  onSaveConfig: (newConfig: AppConfig) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [formConfig, setFormConfig] = React.useState<AppConfig>(config);

  React.useEffect(() => {
    setFormConfig(config);
  }, [config]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(formConfig);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md transition-opacity">
      <div className="relative w-full max-w-lg p-6 bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl space-y-6 text-neutral-100">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h2 className="text-xl font-semibold tracking-wide">Sam Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5 text-sm">
          
          {/* WebSocket Server Endpoint */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2 font-medium text-neutral-300">
              <Server className="w-4 h-4 text-sky-400" />
              <span>WebSocket Backend URL</span>
            </label>
            <input
              type="text"
              value={formConfig.wsUrl}
              onChange={(e) => setFormConfig({ ...formConfig, wsUrl: e.target.value })}
              placeholder="ws://127.0.0.1:8998/api/chat"
              className="w-full px-4 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              required
            />
            <p className="text-xs text-neutral-500">
              Sam speech backend endpoint (e.g. ws://127.0.0.1:8998 or wss://your-cloud-gpu.com:8998).
            </p>
          </div>

          {/* Sample Rate */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block font-medium text-neutral-300">Target Sample Rate</label>
              <select
                value={formConfig.sampleRate}
                onChange={(e) => setFormConfig({ ...formConfig, sampleRate: Number(e.target.value) })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={24000}>24,000 Hz (Sam Native)</option>
                <option value={16000}>16,000 Hz (Standard Speech)</option>
                <option value={48000}>48,000 Hz (High Quality)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block font-medium text-neutral-300">PCM Audio Format</label>
              <select
                value={formConfig.format}
                onChange={(e) => setFormConfig({ ...formConfig, format: e.target.value as 'int16' | 'float32' })}
                className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="int16">Int16 PCM (16-bit signed)</option>
                <option value="float32">Float32 PCM (32-bit float)</option>
              </select>
            </div>
          </div>

          {/* Talk Mode */}
          <div className="space-y-2">
            <label className="flex items-center space-x-2 font-medium text-neutral-300">
              <Radio className="w-4 h-4 text-emerald-400" />
              <span>Mic Mode</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormConfig({ ...formConfig, talkMode: 'continuous' })}
                className={`py-2.5 px-4 rounded-xl border text-center font-medium transition ${
                  formConfig.talkMode === 'continuous'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                Continuous Streaming
              </button>
              <button
                type="button"
                onClick={() => setFormConfig({ ...formConfig, talkMode: 'pushtotalk' })}
                className={`py-2.5 px-4 rounded-xl border text-center font-medium transition ${
                  formConfig.talkMode === 'pushtotalk'
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                }`}
              >
                Push-to-Talk
              </button>
            </div>
          </div>

          {/* Audio Processing Features */}
          <div className="space-y-3 pt-2 border-t border-neutral-800">
            <label className="flex items-center space-x-2 font-medium text-neutral-300">
              <Mic className="w-4 h-4 text-purple-400" />
              <span>Browser Audio Constraints</span>
            </label>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800/80 cursor-pointer">
                <div>
                  <div className="font-medium text-neutral-200">Echo Cancellation</div>
                  <div className="text-xs text-neutral-500">Prevents AI feedback loops</div>
                </div>
                <input
                  type="checkbox"
                  checked={formConfig.echoCancellation}
                  onChange={(e) => setFormConfig({ ...formConfig, echoCancellation: e.target.checked })}
                  className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800/80 cursor-pointer">
                <div>
                  <div className="font-medium text-neutral-200">Noise Suppression</div>
                  <div className="text-xs text-neutral-500">Filters background noise</div>
                </div>
                <input
                  type="checkbox"
                  checked={formConfig.noiseSuppression}
                  onChange={(e) => setFormConfig({ ...formConfig, noiseSuppression: e.target.checked })}
                  className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-950 border border-neutral-800/80 cursor-pointer">
                <div>
                  <div className="font-medium text-neutral-200">Auto Gain Control</div>
                  <div className="text-xs text-neutral-500">Normalizes input volume</div>
                </div>
                <input
                  type="checkbox"
                  checked={formConfig.autoGainControl}
                  onChange={(e) => setFormConfig({ ...formConfig, autoGainControl: e.target.checked })}
                  className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-neutral-800 text-neutral-400 hover:bg-neutral-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition shadow-lg shadow-indigo-600/30"
            >
              Save Settings
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};
