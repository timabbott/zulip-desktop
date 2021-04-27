"use strict";
const test = require("tape");

const setup = require("../spectron_lib/common");

// Create new org link should open in the default browser [WIP]

test("new-org-link", async (t) => {
  t.timeoutAfter(50e3);
  setup.resetTestDataDir();
  const app = setup.createApp();
  try {
    await setup.waitForLoad(app, t);
    await app.client.windowByIndex(1); // Focus on webview
    await (await app.client.$("#open-create-org-link")).click(); // Click on new org link button
    await setup.wait(5000);
    await setup.endTest(app, t);
  } catch (error) {
    await setup.endTest(app, t, error || "error");
  }
});
