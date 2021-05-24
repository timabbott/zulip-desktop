"use strict";
const test = require("tape");

const setup = require("../spectron_lib/common");

test("app runs", async (t) => {
  t.timeoutAfter(10e3);
  setup.resetTestDataDir();
  const app = setup.createApp();
  try {
    await setup.waitForLoad(app, t);
    await app.client.windowByIndex(1); // Focus on webview
    await (await app.client.$('//*[@id="connect"]')).waitForExist(); // Id of the connect button
    await setup.endTest(app, t);
  } catch (error) {
    await setup.endTest(app, t, error || "error");
  }
});
