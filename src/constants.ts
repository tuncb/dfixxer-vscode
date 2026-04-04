export const extensionName = "dfixxer";
export const configurationSection = extensionName;
export const managedDfixxerReleaseTag = "v0.14.0";

export const commandIds = {
  createConfig: "dfixxer.createConfig",
  fixCurrentFile: "dfixxer.fixCurrentFile",
  updateExecutable: "dfixxer.updateExecutable",
} as const;

export const supportedLanguageIds = ["pascal", "objectpascal"] as const;

export const configurationKeys = {
  configurationFile: "configurationFile",
  executablePath: "executablePath",
  formatOnSave: "formatOnSave",
} as const;
