// Theme presets for nclaw-cli — chalk-compatible color names or hex strings.
// Ink's `color` prop accepts these directly.

export interface ThemeColors {
  text:         string;
  textMuted:    string;
  textInverse:  string;
  textFaint?:   string;

  primary:      string;
  secondary:    string;
  accent:       string;
  brand?:       string;

  success:      string;
  warning:      string;
  error:        string;
  info:         string;

  border:       string;
  borderActive: string;
  borderWarn:   string;
  borderError:  string;

  selection?:   string;
  surface?:     string;
  dimSeparator?: string;
}

export interface ThemePreset {
  name:   string;
  colors: ThemeColors;
}

export const defaultTheme: ThemePreset = {
  name: 'default',
  colors: {
    text:        'white',
    textMuted:   'gray',
    textInverse: 'black',
    textFaint:   'gray',

    primary:     'magenta',
    secondary:   'cyanBright',
    accent:      'yellow',
    brand:       'magenta',

    success:     'green',
    warning:     'yellow',
    error:       'red',
    info:        'blueBright',

    border:      'gray',
    borderActive:'cyan',
    borderWarn:  'yellow',
    borderError: 'red',

    selection:   'cyan',
    surface:     'black',
    dimSeparator:'gray',
  },
};

export const darkTheme: ThemePreset = {
  name: 'dark',
  colors: {
    text:        '#E1E1E1',
    textMuted:   '#888888',
    textInverse: 'black',
    textFaint:   '#555555',

    primary:     '#FF79C6',
    secondary:   '#8BE9FD',
    accent:      '#F1FA8C',
    brand:       '#BD93F9',

    success:     '#50FA7B',
    warning:     '#FFB86C',
    error:       '#FF5555',
    info:        '#8BE9FD',

    border:      '#444444',
    borderActive:'#8BE9FD',
    borderWarn:  '#FFB86C',
    borderError: '#FF5555',

    selection:   '#44475A',
    surface:     '#282A36',
    dimSeparator:'#6272A4',
  },
};

export const highContrastTheme: ThemePreset = {
  name: 'high-contrast',
  colors: {
    text:        'white',
    textMuted:   'whiteBright',
    textInverse: 'black',
    textFaint:   'whiteBright',

    primary:     'cyanBright',
    secondary:   'greenBright',
    accent:      'yellowBright',
    brand:       'magentaBright',

    success:     'greenBright',
    warning:     'yellowBright',
    error:       'redBright',
    info:        'blueBright',

    border:      'white',
    borderActive:'cyanBright',
    borderWarn:  'yellowBright',
    borderError: 'redBright',

    selection:   'white',
    surface:     'black',
    dimSeparator:'white',
  },
};

export const THEMES: ThemePreset[] = [defaultTheme, darkTheme, highContrastTheme];
