import { writable, get } from 'svelte/store';
import type { Settings, ThemeName } from '$lib/types/ui';
import { applyThemeToDocument } from '../utils/themes';

// Default settings
const defaultSettings: Settings = {
  theme: 'dark',
  dropdownMode: 'signer-first',
  runtimeDelay: 250, // 250ms = 4 frames/second (visible lightning effects)
  portfolioScale: 5000, // Default scale: $5000 max for portfolio bars
  componentStates: {}
};

// Settings store
export const settings = writable<Settings>(defaultSettings);

// Storage keys
const SETTINGS_KEY = 'xln-settings';
const COMPONENT_STATES_KEY = 'xlnComponentStates';

// Settings operations
const settingsOperations = {
  // Load settings from localStorage
  loadFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      
      // Load main settings
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        settings.update(current => ({ ...current, ...parsed }));
      }
      
      // Load component states
      const savedComponentStates = localStorage.getItem(COMPONENT_STATES_KEY);
      if (savedComponentStates) {
        const componentStates = JSON.parse(savedComponentStates);
        settings.update(current => ({ ...current, componentStates }));
      }
      
      console.log('[SET] Settings loaded from localStorage');
    } catch (error) {
      console.error('[X] Failed to load settings:', error);
      settings.set(defaultSettings);
    }
  },

  // Save settings to localStorage
  saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      
      const currentSettings = get(settings);
      
      // Save main settings (excluding componentStates)
      const { componentStates, ...mainSettings } = currentSettings;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(mainSettings));
      
      // Save component states separately
      localStorage.setItem(COMPONENT_STATES_KEY, JSON.stringify(componentStates));
      
      console.log('[DISK] Settings saved to localStorage');
    } catch (error) {
      console.error('[X] Failed to save settings:', error);
    }
  },

  // Update theme
  setTheme(theme: ThemeName) {
    settings.update(current => ({ ...current, theme }));
    this.saveToStorage();
    applyThemeToDocument(theme);
  },

  // Update dropdown mode
  setDropdownMode(mode: 'signer-first' | 'entity-first') {
    settings.update(current => ({ ...current, dropdownMode: mode }));
    this.saveToStorage();
  },

  // Toggle dropdown mode
  toggleDropdownMode() {
    const current = get(settings);
    this.setDropdownMode(current.dropdownMode === 'signer-first' ? 'entity-first' : 'signer-first');
  },

  // Update server delay
  setServerDelay(delay: number) {
    settings.update(current => ({ ...current, runtimeDelay: delay }));
    this.saveToStorage();
  },

  // Update portfolio scale
  setPortfolioScale(scale: number) {
    settings.update(current => ({ ...current, portfolioScale: scale }));
    this.saveToStorage();
  },

  // Get component state (expanded/collapsed)
  getComponentState(componentId: string): boolean {
    const current = get(settings);
    if (current.componentStates[componentId] !== undefined) {
      return current.componentStates[componentId];
    }
    
    // Default states: consensus and chat expanded, others collapsed
    return componentId.includes('consensus-') || componentId.includes('chat-');
  },

  // Set component state
  setComponentState(componentId: string, isExpanded: boolean) {
    settings.update(current => ({
      ...current,
      componentStates: {
        ...current.componentStates,
        [componentId]: isExpanded
      }
    }));
    this.saveToStorage();
  },

  // Toggle component state
  toggleComponentState(componentId: string) {
    const currentState = this.getComponentState(componentId);
    this.setComponentState(componentId, !currentState);
  },

  // Reset to defaults
  resetToDefaults() {
    settings.set(defaultSettings);
    this.saveToStorage();
    
    // Clear localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(COMPONENT_STATES_KEY);
    }
  },

  // Initialize settings
  initialize() {
    this.loadFromStorage();

    // Apply initial theme
    const current = get(settings);
    applyThemeToDocument(current.theme);
  }
};

// Export stores and operations
export { settingsOperations };
