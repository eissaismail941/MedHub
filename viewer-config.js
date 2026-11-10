/* Public settings only. */
window.MEDHUB_VIEWER_CONFIG = {
  pdfjsBase:
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/",

  supabase: {
    url: "https://lxmxsymxmpulkkngjfjo.supabase.co",

    anonKey: "sb_publishable_-7LnL-kzS1omjDFD5va_0A_Tjdh3m8h",

    table: "lectures",
    idColumn: "id",
    titleColumn: "title",

    urlColumn: "",
    pathColumn: "file_path",
    bucket: "lectures",

    versionColumn: ""
  }
};