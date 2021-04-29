import {Notification, app, net} from "electron";

import getStream from "get-stream";
import * as semver from "semver";

import * as ConfigUtil from "../common/config-util";
import Logger from "../common/logger-util";

import * as LinuxUpdateUtil from "./linux-update-util";
import {fetchResponse} from "./request";

const logger = new Logger({
  file: "linux-update-util.log",
});

export async function linuxUpdateNotification(
  session: Electron.session,
): Promise<void> {
  let url = "https://api.github.com/repos/zulip/zulip-desktop/releases";
  url = ConfigUtil.getConfigItem("betaUpdate", false) ? url : url + "/latest";

  try {
    const response = await fetchResponse(net.request({url, session}));
    if (response.statusCode !== 200) {
      logger.log("Linux update response status: ", response.statusCode);
      return;
    }

    const data = JSON.parse(await getStream(response));
    const latestVersion = ConfigUtil.getConfigItem("betaUpdate", false)
      ? data[0].tag_name
      : data.tag_name;
    if (typeof latestVersion !== "string") {
      throw new TypeError("Expected string for tag_name");
    }

    if (semver.gt(latestVersion, app.getVersion())) {
      const notified = LinuxUpdateUtil.getUpdateItem(latestVersion);
      if (notified === null) {
        new Notification({
          title: "Zulip Update",
          body: `A new version ${latestVersion} is available. Please update using your package manager.`,
        }).show();
        LinuxUpdateUtil.setUpdateItem(latestVersion, true);
      }
    }
  } catch (error: unknown) {
    logger.error("Linux update error.");
    logger.error(error);
  }
}
