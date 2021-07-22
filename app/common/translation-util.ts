import path from "path";

import i18n from "i18n";

import * as ConfigUtil from "./config-util";

i18n.configure({
  directory: path.join(__dirname, "../translations/"),
  updateFiles: false,
});

/* Fetches the current appLocale from settings.json */
const appLocale = ConfigUtil.getConfigItem("appLanguage", "en");

/* If no locale present in the json, en is set default */
export function __(
  phrase: string,
  replacements: i18n.Replacements = {},
): string {
  return i18n.__({phrase, locale: appLocale ? appLocale : "en"}, replacements);
}
