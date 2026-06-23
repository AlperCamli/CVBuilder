export type CvFontAssetKey =
  | "noto-sans"
  | "noto-serif"
  | "latin-modern-roman"
  | "new-computer-modern"
  | "libertinus-serif"
  | "source-serif-4"
  | "source-sans-3"
  | "ibm-plex-sans";

export interface CvFontDefinition {
  key: CvFontAssetKey;
  family: string;
  fallback: "serif" | "sans-serif";
  regularFile: string;
  boldFile: string;
}

export const DEFAULT_CV_FONT_ASSET_KEY: CvFontAssetKey = "noto-sans";

export const CV_FONT_DEFINITIONS: Record<CvFontAssetKey, CvFontDefinition> = {
  "noto-sans": {
    key: "noto-sans",
    family: "Noto Sans",
    fallback: "sans-serif",
    regularFile: "NotoSans-Regular.ttf",
    boldFile: "NotoSans-Bold.ttf"
  },
  "noto-serif": {
    key: "noto-serif",
    family: "Noto Serif",
    fallback: "serif",
    regularFile: "NotoSerif-Regular.ttf",
    boldFile: "NotoSerif-Bold.ttf"
  },
  "latin-modern-roman": {
    key: "latin-modern-roman",
    family: "Latin Modern Roman",
    fallback: "serif",
    regularFile: "LatinModernRoman-Regular.otf",
    boldFile: "LatinModernRoman-Bold.otf"
  },
  "new-computer-modern": {
    key: "new-computer-modern",
    family: "New Computer Modern",
    fallback: "serif",
    regularFile: "NewComputerModern-Regular.otf",
    boldFile: "NewComputerModern-Bold.otf"
  },
  "libertinus-serif": {
    key: "libertinus-serif",
    family: "Libertinus Serif",
    fallback: "serif",
    regularFile: "LibertinusSerif-Regular.otf",
    boldFile: "LibertinusSerif-Bold.otf"
  },
  "source-serif-4": {
    key: "source-serif-4",
    family: "Source Serif 4",
    fallback: "serif",
    regularFile: "SourceSerif4-Regular.ttf",
    boldFile: "SourceSerif4-Bold.ttf"
  },
  "source-sans-3": {
    key: "source-sans-3",
    family: "Source Sans 3",
    fallback: "sans-serif",
    regularFile: "SourceSans3-Regular.ttf",
    boldFile: "SourceSans3-Bold.ttf"
  },
  "ibm-plex-sans": {
    key: "ibm-plex-sans",
    family: "IBM Plex Sans",
    fallback: "sans-serif",
    regularFile: "IBMPlexSans-Regular.ttf",
    boldFile: "IBMPlexSans-Bold.ttf"
  }
};

export const resolveCvFontDefinition = (
  key: CvFontAssetKey | undefined
): CvFontDefinition => CV_FONT_DEFINITIONS[key ?? DEFAULT_CV_FONT_ASSET_KEY];

export const buildCvFontFamily = (key: CvFontAssetKey): string => {
  const font = resolveCvFontDefinition(key);
  return `"${font.family}", ${font.fallback}`;
};
