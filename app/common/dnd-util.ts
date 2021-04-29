import * as ConfigUtil from "./config-util";

type SettingName = keyof DNDSettings;

export interface DNDSettings {
  showNotification: boolean;
  silent: boolean;
  flashTaskbarOnMessage: boolean;
}

interface Toggle {
  dnd: boolean;
  newSettings: Partial<DNDSettings>;
}

export function toggle(): Toggle {
  const dnd = !ConfigUtil.getConfigItem("dnd", false);
  const dndSettingList: SettingName[] = ["showNotification", "silent"];
  if (process.platform === "win32") {
    dndSettingList.push("flashTaskbarOnMessage");
  }

  let newSettings: Partial<DNDSettings>;
  if (dnd) {
    const oldSettings: Partial<DNDSettings> = {};
    newSettings = {};

    // Iterate through the dndSettingList.
    for (const settingName of dndSettingList) {
      // Store the current value of setting.
      oldSettings[settingName] = ConfigUtil.getConfigItem(
        settingName,
        settingName !== "silent",
      );
      // New value of setting.
      newSettings[settingName] = settingName === "silent";
    }

    // Store old value in oldSettings.
    ConfigUtil.setConfigItem("dndPreviousSettings", oldSettings);
  } else {
    newSettings = ConfigUtil.getConfigItem("dndPreviousSettings", {
      showNotification: true,
      silent: false,
      ...(process.platform === "win32" && {flashTaskbarOnMessage: true}),
    });
  }

  for (const settingName of dndSettingList) {
    ConfigUtil.setConfigItem(settingName, newSettings[settingName]!);
  }

  ConfigUtil.setConfigItem("dnd", dnd);
  return {dnd, newSettings};
}
