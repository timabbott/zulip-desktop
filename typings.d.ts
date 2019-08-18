declare module 'adm-zip';
declare module 'auto-launch';
declare module 'is-online';
declare module 'request';
declare module 'semver';
declare module '@electron-elements/send-feedback';
declare module 'node-mac-notifier';
declare module 'electron-connect';
declare module 'electron-is-dev';
declare module 'electron-spellchecker';
declare module 'escape-html';
declare module 'fs-extra';
declare module 'wurl';
declare module 'i18n';
declare module 'level';

interface PageParamsObject {
    realm_uri: string;
    default_language: string;
}
declare var page_params: PageParamsObject;

// since requestIdleCallback didn't make it into lib.dom.d.ts yet
declare function requestIdleCallback(callback: Function, options?: object): void;

// Patch Notification object so we can implement our side
// of Notification classes which we export into zulip side through
// preload.js; if we don't do his extending Notification will throw error.
// Relevant code is in app/renderer/js/notification/default-notification.ts
// and the relevant function is requestPermission.
declare var PatchedNotification: {
  prototype: Notification;
  new(title: string, options?: NotificationOptions): Notification;
  readonly maxActions: number;
  readonly permission: NotificationPermission;
  requestPermission(): void;
}

// This is mostly zulip side of code we access from window
interface Window {
  $: any;
  narrow: any
  Notification: typeof PatchedNotification;
}

// typescript doesn't have up to date NotificationOptions yet
interface NotificationOptions {
  silent?: boolean;
}

interface ZulipWebWindow extends Window {
    electron_bridge: any;
    tray: any;
    $: any;
    lightbox: any;
}

interface Domain {
  icon: string;
  url: string;
  alias: string;
  ignoreCerts: boolean;
}

enum BatchOperation {
  'del',
  'put'
}

interface DomainBatchOperation {
  type: BatchOperation;
  key: string;
  value: Domain;
}
