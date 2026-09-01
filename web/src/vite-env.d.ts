interface ImportMetaEnv {
  readonly DD_APPLICATION_ID?: string;
  readonly DD_CLIENT_TOKEN?: string;
  readonly DD_SITE?: string;
  readonly DD_SERVICE?: string;
  readonly DD_ENV?: string;
  readonly DD_VERSION?: string;
  readonly DD_REQUIRE?: string;
  readonly VITE_GOOGLE_CONTACTS_CLIENT_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
