(() => {
    "use strict";

    /* These three values are PUBLIC by design (publishable key + admin user id).
       Real security lives in the Supabase policies (see the SQL step).
       Never put a secret / service_role key in this file. */
    const SUPABASE_URL =
        "https://lxmxsymxmpulkkngjfjo.supabase.co";

    const PUBLIC_KEY =
        "sb_publishable_-7LnL-kzS1omjDFD5va_0A_Tjdh3m8h";

    const ADMIN_IDS = [
    "475f2fec-d7da-4443-91dc-d75e03dfacbd",
    "02bec3ff-297a-4ff9-8d84-4f004e9b0f80"
];

const isAdmin = (userId) => ADMIN_IDS.includes(userId);

    const BUCKET = "lectures";
    const MAX_BYTES = 50 * 1024 * 1024;
    const MAX_FILES = 20;
    const CONCURRENCY = 2;
    const MAX_PREVIEW_PAGES = 30;
    const PDFJS_BASE =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

    const $ = id => document.getElementById(id);
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

    const SESSION_KEY = "medhub-admin-session";

function readSavedSession() {
    try {
        const saved = JSON.parse(
            localStorage.getItem(SESSION_KEY) || "null"
        );
        
        if (
            isAdmin(saved?.user?.id) &&
            saved.access_token &&
            saved.refresh_token &&
            Number.isFinite(saved.expires)
        ) {
            return saved;
        }
        
        localStorage.removeItem(SESSION_KEY);
    } catch {}
    
    return null;
}

function saveSession(value) {
    try {
        if (value) {
            localStorage.setItem(
                SESSION_KEY,
                JSON.stringify(value)
            );
        } else {
            localStorage.removeItem(SESSION_KEY);
        }
    } catch {
        console.warn("Browser could not save the sign-in session.");
    }
}

let session = readSavedSession();
    let refreshing = null;   // shared promise so tokens refresh once
    let busy = false;        // a save / upload / delete is running
    let loading = false;     // lectures are being fetched
    let saving = false;      // a re-order is being saved
    let arranging = false;   // arrange mode on the subject page
    let lastRows = [];
    let fab = null;
    let acct = null;
    let toolbar = null;
    let sheetKey = null;     // subject the upload sheet holds a draft for
    let queue = [];          // PDFs waiting to be published
    let queueId = 0;
    let editRow = null;
    let deleteRow = null;
    let replaceRow = null;
    let replaceState = null;

    const TYPES = ["Lecture", "SGL", "LG", "Lab", "Practical", "Theory"];

    /* ---------- Icons ---------- */
    const icon = (paths, size = 20, width = 2) =>
        `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
        `stroke="currentColor" stroke-width="${width}" stroke-linecap="round" ` +
        `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

    const ICON = {
        close: icon('<path d="M6 6l12 12M18 6L6 18"/>'),
        plus: icon('<path d="M12 5v14M5 12h14"/>', 28, 2.6),
        lock: icon('<rect x="4" y="10.5" width="16" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', 26),
        eye: icon('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
        eyeOff: icon('<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1"/>'),
        folder: icon('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>', 16),
        pdf: icon('<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/><path d="M12 17v-5M9.5 14.5L12 12l2.5 2.5"/>', 24),
        file: icon('<path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 3v5h5"/>', 22),
        check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 24, 2.4),
        more: icon('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>', 22, 3),
        edit: icon('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', 19),
        trash: icon('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>', 19),
        replace: icon('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>', 19),
        up: icon('<path d="M12 19V5M6 11l6-6 6 6"/>', 19),
        down: icon('<path d="M12 5v14M6 13l6 6 6-6"/>', 19),
        sort: icon('<path d="M7 4v16M3.5 7.5L7 4l3.5 3.5M17 20V4M13.5 16.5L17 20l3.5-3.5"/>', 18),
        logout: icon('<path d="M9 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20H9M15 8l4 4-4 4M19 12H9"/>', 19),
        refresh: icon('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', 19),
        info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 18),
        warn: icon('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>', 26)
    };

    /* ---------- Small helpers ---------- */
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function message(node, text, kind = "error") {
        node.textContent = text || "";
        node.dataset.kind = kind;
        node.hidden = !text;
    }

    function setBusyButton(button, on, label) {
        button.classList.toggle("is-busy", on);
        button.querySelector(".mh-btn-text").textContent = label;
    }

    function formatSize(bytes) {
        return bytes >= 1048576
            ? (bytes / 1048576).toFixed(1) + " MB"
            : Math.max(1, Math.round(bytes / 1024)) + " KB";
    }

    function encodePath(path) {
        return path.split("/").map(encodeURIComponent).join("/");
    }

    function pdfURL(path) {
        return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" +
            encodePath(path);
    }

    function isPDFFile(file) {
        return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    }

    function titleFromName(name) {
        return name
            .replace(/\.pdf$/i, "")
            .replace(/[_-]+/g, " ")
            .trim()
            .slice(0, 200);
    }

    function safeStoragePath(path) {
        return typeof path === "string" && path.length > 0 &&
            !path.includes("..") && !path.startsWith("/");
    }

    /* ---------- Dialog factory ---------- */
    const dialogs = [];
    let loginDialog;

    function makeDialog(className, html, labelledBy) {
        const dialog = document.createElement("dialog");
        dialog.className = "mh-dialog " + className;
        if (labelledBy) dialog.setAttribute("aria-labelledby", labelledBy);
        dialog.innerHTML = html;

        /* Stop the site's iOS focus fix from closing the keyboard here. */
        dialog.addEventListener("touchend", event => event.stopPropagation());

        dialog.addEventListener("cancel", event => {
            if (busy) event.preventDefault();
        });

        /* Close on a backdrop tap, but not after a text-selection drag. */
        let downOnBackdrop = false;

        dialog.addEventListener("pointerdown", event => {
            downOnBackdrop = event.target === dialog;
        });

        dialog.addEventListener("click", event => {
            if (event.target === dialog && downOnBackdrop && !busy) {
                dialog.close();
            }
        });

        dialog.addEventListener("close", () => {
            if (!dialogs.some(item => item.open)) {
                document.documentElement.classList.remove("mh-lock");
            }

            if (dialog === loginDialog) cleanHash();
        });

        dialogs.push(dialog);
        document.body.append(dialog);
        return dialog;
    }

    function openModal(dialog) {
        if (!dialog.open) dialog.showModal();
        document.documentElement.classList.add("mh-lock");
    }

    function cleanHash() {
        if (location.hash === "#admin") {
            history.replaceState(
                history.state,
                "",
                location.pathname + location.search
            );
        }
    }

    /* ---------- Sign-in window (unchanged flow) ---------- */
    loginDialog = makeDialog("mh-login-dialog", `
        <button id="mh-login-close" class="mh-icon-btn mh-close"
            type="button" aria-label="Close">${ICON.close}</button>
        <div class="mh-badge">${ICON.lock}</div>
        <h2 id="mh-login-title">Admin sign in</h2>

        <form id="mh-login">
            <p class="mh-lead" style="margin:-8px 0 2px">
                Sign in to manage lectures on MedHub.
            </p>
            <div class="mh-field">
                <label for="mh-email">Email</label>
                <input id="mh-email" type="email" inputmode="email"
                    autocomplete="username" required>
            </div>
            <div class="mh-field">
                <label for="mh-password">Password</label>
                <div class="mh-pw">
                    <input id="mh-password" type="password"
                        autocomplete="current-password" required>
                    <button id="mh-pw-toggle" type="button"
                        aria-label="Show password"
                        aria-pressed="false">${ICON.eye}</button>
                </div>
            </div>
            <div id="mh-login-error" class="mh-alert" role="alert" hidden></div>
            <button id="mh-signin" class="mh-btn mh-btn-primary">
                <span class="mh-spinner" aria-hidden="true"></span>
                <span class="mh-btn-text">Sign in</span>
            </button>
        </form>

        <div id="mh-account" class="mh-account" hidden>
            <div class="mh-account-card">
                <div id="mh-avatar" class="mh-avatar" aria-hidden="true"></div>
                <div>
                    <strong id="mh-account-email"></strong>
                    <span>Admin account</span>
                </div>
            </div>
            <p class="mh-lead">
                Open a subject's lecture page to add, edit, replace, re-order
                or delete lectures.
            </p>
            <div class="mh-actions">
                <button id="mh-signout" type="button"
                    class="mh-btn mh-btn-ghost">Sign out</button>
                <button id="mh-account-done" type="button"
                    class="mh-btn mh-btn-primary">Done</button>
            </div>
        </div>
    `, "mh-login-title");
    loginDialog.id = "mh-login-dialog";

    /* ---------- Upload sheet (one or many PDFs) ---------- */
    const sheet = makeDialog("mh-sheet", `
        <form id="mh-upload" class="mh-sheet-form" novalidate>
            <div class="mh-sheet-head">
                <div class="mh-grab" aria-hidden="true"></div>
                <div class="mh-head-row">
                    <div>
                        <h2 id="mh-sheet-title">Add lectures</h2>
                        <p id="mh-dest" class="mh-dest"
                            aria-label="Publishing to"></p>
                    </div>
                    <button id="mh-sheet-close" class="mh-icon-btn"
                        type="button" aria-label="Close">${ICON.close}</button>
                </div>
            </div>

            <div class="mh-sheet-body">
                <label id="mh-drop" class="mh-drop" for="mh-file">
                    <span id="mh-drop-icon" class="mh-drop-icon">${ICON.pdf}</span>
                    <strong id="mh-drop-title">Choose PDFs</strong>
                    <small id="mh-drop-sub">Tap to browse. Pick several at once. Up to 50 MB each.</small>
                    <input id="mh-file" type="file" multiple
                        accept=".pdf,application/pdf">
                </label>

                <div id="mh-queue" class="mh-queue" aria-live="polite"></div>
                <div id="mh-summary" class="mh-summary" hidden></div>
                <div id="mh-status" class="mh-alert" role="status"
                    aria-live="polite" hidden></div>
            </div>

            <div class="mh-sheet-foot">
                <button id="mh-cancel" type="button"
                    class="mh-btn mh-btn-ghost">Cancel</button>
                <button id="mh-publish" class="mh-btn mh-btn-primary">
                    <span class="mh-spinner" aria-hidden="true"></span>
                    <span class="mh-btn-text">Publish lecture</span>
                </button>
            </div>
        </form>
    `, "mh-sheet-title");

    /* ---------- Edit dialog ---------- */
    const editDialog = makeDialog("mh-sheet", `
        <form id="mh-edit" class="mh-sheet-form" novalidate>
            <div class="mh-sheet-head">
                <div class="mh-grab" aria-hidden="true"></div>
                <div class="mh-head-row">
                    <div>
                        <h2 id="mh-edit-heading">Edit lecture</h2>
                        <p id="mh-edit-dest" class="mh-dest"></p>
                    </div>
                    <button id="mh-edit-close" class="mh-icon-btn"
                        type="button" aria-label="Close">${ICON.close}</button>
                </div>
            </div>
            <div class="mh-sheet-body">
                <label class="mh-field">
                    <span class="mh-flabel">Lecture title</span>
                    <input id="mh-edit-title" type="text" maxlength="200"
                        autocomplete="off" required>
                </label>
                <fieldset class="mh-field">
                    <legend>Type</legend>
                    <div id="mh-edit-types" class="mh-types"></div>
                </fieldset>
                <label class="mh-field">
                    <span class="mh-flabel">Label<span class="mh-opt">Optional</span></span>
                    <input id="mh-edit-desc" type="text" maxlength="200"
                        autocomplete="off" placeholder="e.g. Lab 8">
                </label>
                <label class="mh-field mh-date-field">
                    <span class="mh-flabel">Lecture date <span class="mh-opt">Optional · actual teaching date</span></span>
                    <input id="mh-edit-date" type="date" aria-label="Actual lecture date">
                </label>
                <div class="mh-note">${ICON.info}<span>
                    The PDF file and the lecture's position stay the same.
                    Use “Replace PDF” in the ⋮ menu to change the file.
                </span></div>
                <div id="mh-edit-status" class="mh-alert" role="status"
                    aria-live="polite" hidden></div>
            </div>
            <div class="mh-sheet-foot">
                <button id="mh-edit-cancel" type="button"
                    class="mh-btn mh-btn-ghost">Cancel</button>
                <button id="mh-edit-save" class="mh-btn mh-btn-primary">
                    <span class="mh-spinner" aria-hidden="true"></span>
                    <span class="mh-btn-text">Save changes</span>
                </button>
            </div>
        </form>
    `, "mh-edit-heading");

    /* ---------- Replace-PDF dialog ---------- */
    const replaceDialog = makeDialog("mh-sheet", `
        <form id="mh-replace" class="mh-sheet-form" novalidate>
            <div class="mh-sheet-head">
                <div class="mh-grab" aria-hidden="true"></div>
                <div class="mh-head-row">
                    <div>
                        <h2 id="mh-replace-heading">Replace PDF</h2>
                        <p id="mh-replace-dest" class="mh-dest"></p>
                    </div>
                    <button id="mh-replace-close" class="mh-icon-btn"
                        type="button" aria-label="Close">${ICON.close}</button>
                </div>
            </div>
            <div class="mh-sheet-body">
                <div class="mh-note">${ICON.info}<span>
                    Title, type, label and position are kept. Only the PDF
                    changes, and the old PDF file is deleted from storage.
                </span></div>
                <label id="mh-rdrop" class="mh-drop" for="mh-rfile">
                    <span id="mh-rdrop-icon" class="mh-drop-icon">${ICON.pdf}</span>
                    <strong id="mh-rdrop-title">Choose the new PDF</strong>
                    <small id="mh-rdrop-sub">Tap to browse. Up to 50 MB.</small>
                    <input id="mh-rfile" type="file"
                        accept=".pdf,application/pdf">
                </label>
                <button id="mh-rpreview" type="button"
                    class="mh-btn mh-btn-ghost" hidden>
                    ${ICON.eye}<span>Preview new PDF</span>
                </button>
                <div id="mh-rprogress" class="mh-progress" hidden>
                    <span id="mh-rprogress-text">Uploading…</span>
                    <div class="mh-bar"><span id="mh-rbar"></span></div>
                </div>
                <div id="mh-replace-status" class="mh-alert" role="status"
                    aria-live="polite" hidden></div>
            </div>
            <div class="mh-sheet-foot">
                <button id="mh-replace-cancel" type="button"
                    class="mh-btn mh-btn-ghost">Cancel</button>
                <button id="mh-replace-save" class="mh-btn mh-btn-primary">
                    <span class="mh-spinner" aria-hidden="true"></span>
                    <span class="mh-btn-text">Replace PDF</span>
                </button>
            </div>
        </form>
    `, "mh-replace-heading");

    /* ---------- Delete confirmation ---------- */
    const confirmDialog = makeDialog("mh-confirm", `
        <div class="mh-badge is-danger">${ICON.warn}</div>
        <h2 id="mh-confirm-title">Delete this lecture?</h2>
        <div class="mh-body">
            <div id="mh-confirm-name" class="mh-confirm-name"></div>
            <p class="mh-lead" style="margin:0 !important">
                The lecture disappears from MedHub for every student, and its
                PDF file is <strong>permanently deleted from storage</strong>.
                This cannot be undone.
            </p>
            <div id="mh-confirm-status" class="mh-alert" role="alert" hidden></div>
        </div>
        <div class="mh-actions">
            <button id="mh-confirm-cancel" type="button"
                class="mh-btn mh-btn-ghost">Cancel</button>
            <button id="mh-confirm-delete" type="button"
                class="mh-btn mh-btn-danger">
                <span class="mh-spinner" aria-hidden="true"></span>
                <span class="mh-btn-text">Delete</span>
            </button>
        </div>
    `, "mh-confirm-title");

    /* ---------- PDF preview ---------- */
    const previewDialog = makeDialog("mh-preview", `
        <div class="mh-prev-head">
            <div>
                <h2 id="mh-prev-title">Preview</h2>
                <p id="mh-prev-sub"></p>
            </div>
            <button id="mh-prev-x" class="mh-icon-btn" type="button"
                aria-label="Close preview">${ICON.close}</button>
        </div>
        <div id="mh-prev-body" class="mh-prev-body"></div>
        <div class="mh-prev-foot">
            <a id="mh-prev-open" class="mh-btn mh-btn-ghost"
                target="_blank" rel="noopener">Open in new tab</a>
            <button id="mh-prev-close" type="button"
                class="mh-btn mh-btn-primary">Done</button>
        </div>
    `, "mh-prev-title");

    const toastEl = el("div", "mh-toast");
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");

    const notice = el("div");
    notice.id = "mh-cloud-status";
    notice.setAttribute("role", "status");

    document.body.append(toastEl, notice);

    let toastTimer;

    function toast(text, kind = "info") {
        toastEl.textContent = text;
        toastEl.dataset.kind = kind;
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(
            () => toastEl.classList.remove("show"),
            kind === "error" ? 7000 : 4500
        );
    }

    /* ---------- Catalog of subjects (built from your cards) ---------- */
    /* Remember all existing GitHub lectures. */
    const original = Object.fromEntries(
        Object.entries(subjectMap).map(([key, subject]) => [
            key,
            subject.resources.slice()
        ])
    );

    const catalog = [];

    for (const [container, block] of [
        ["block1-content", 1],
        ["subjects-content", 2]
    ]) {
        for (const card of $(container).querySelectorAll(
            ".subject-card"
        )) {
            const action = card.getAttribute("onclick") || "";

            const match = action.match(
                /(?:loadResources|showSplitCards)\('([^']+)'/
            );

            if (!match) continue;

            const name = card.querySelector(".card-name").textContent;
            const split = action.includes("showSplitCards");

            const keys = split
                ? [match[1] + "-theory", match[1] + "-practical"]
                : [match[1]];

            for (const key of keys) {
                if (!subjectMap[key]) continue;

                const suffix = split
                    ? key.endsWith("-theory")
                        ? " · Theory"
                        : " · Practical"
                    : "";

                catalog.push({
                    stage: 1,
                    block,
                    blockLabel: "Block " + block,
                    key,
                    name: name + suffix
                });
            }
        }
    }

    for (const block of stage2Blocks) {
        for (const module of block.modules) {
            catalog.push({
                stage: 2,
                block: block.n,
                blockLabel: block.code,
                key: module.key,
                name: module.name
            });
        }
    }

    /* The subject whose lecture page is open right now. */
    function currentSubject() {
        const state = history.state;

        if (!state || state.v !== "res") return null;

        return catalog.find(subject => subject.key === state.key) || null;
    }

    /* Uploaded lectures (database rows) for one subject, in display order. */
    function rowsFor(subject) {
        return lastRows.filter(row =>
            row.subject === subject.key &&
            row.stage === subject.stage &&
            row.block === subject.block
        );
    }

    function sortRows() {
        lastRows.sort((a, b) => {
            const left = Number(a.sort_order);
            const right = Number(b.sort_order);

            if (left !== right && Number.isFinite(left) && Number.isFinite(right)) {
                return left - right;
            }

            return String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
                String(a.id).localeCompare(String(b.id));
        });
    }

    /* Rebuild every subject's list: GitHub originals first, then uploads. */
    function applyRows() {
        for (const [key, resources] of Object.entries(original)) {
            subjectMap[key].resources = resources.slice();
        }

        for (const row of lastRows) {
            const subject = catalog.find(item =>
                item.key === row.subject &&
                item.stage === row.stage &&
                item.block === row.block
            );

            if (!subject || !safeStoragePath(row.file_path)) continue;

            const url = pdfURL(row.file_path);

            subjectMap[subject.key].resources.push({
                title: row.title,
                description: row.description || row.category,
                url,
                downloadUrl: url + "?download=" +
                    encodeURIComponent(row.title + ".pdf"),
                lectureDate: row.lecture_date || null,
                fileSizeBytes: Number(row.file_size_bytes) || null,
                row
            });
        }
    }

    function rerender() {
        closeMenu();

        if (history.state?.v === "res") {
            renderResourcePage(history.state.key);
        }
    }

    /* ---------- Admin controls (only after sign-in) ---------- */
    function ensureToolbar() {
        if (toolbar) return;

        toolbar = el("div", "mh-toolbar");
        toolbar.hidden = true;
        toolbar.innerHTML = `
            <div class="mh-toolbar-text">
                <strong>Admin</strong>
                <span id="mh-toolbar-sub"></span>
            </div>
            <button id="mh-arrange-toggle" type="button" class="mh-chip-btn"
                aria-pressed="false">${ICON.sort}<span>Arrange</span></button>
        `;

        const grid = $("resource-grid");
        grid.parentNode.insertBefore(toolbar, grid);

        $("mh-arrange-toggle").onclick = () => {
            arranging = !arranging;
            rerender();
        };
    }

    function updateToolbar(items) {
        if (!toolbar) return;

        const uploaded = items.filter(item => item.row).length;
        const originals = items.length - uploaded;

        if (arranging && uploaded < 2) arranging = false;

        $("mh-toolbar-sub").textContent = arranging
            ? "Use the arrows to re-order uploaded lectures."
            : uploaded + " uploaded · " + originals +
              " original (GitHub). Uploads appear after the originals.";

        const toggle = $("mh-arrange-toggle");
        toggle.disabled = uploaded < 2;
        toggle.setAttribute("aria-pressed", String(arranging));
        toggle.querySelector("span").textContent = arranging ? "Done" : "Arrange";
    }

    function syncAdmin() {
        if (!session) {
            fab?.remove();
            fab = null;
            acct?.remove();
            acct = null;
            toolbar?.remove();
            toolbar = null;
            arranging = false;
            closeMenu();
            document.body.classList.remove("mh-has-fab");
            return;
        }

        const subject = currentSubject();

        if (!acct) {
            acct = el("button", "mh-acct");
            acct.type = "button";
            acct.title = "Admin account";
            acct.setAttribute("aria-label", "Admin account menu");
            acct.setAttribute("aria-haspopup", "menu");
            acct.setAttribute("aria-expanded", "false");
            acct.onclick = openAccountMenu;
            document.body.append(acct);
        }

        acct.textContent = (session.user?.email || "A").charAt(0).toUpperCase();

        if (!fab) {
            fab = el("button", "mh-fab");
            fab.type = "button";
            fab.title = "Add lectures";
            fab.setAttribute("aria-label", "Add lectures");
            fab.setAttribute("aria-haspopup", "dialog");
            fab.innerHTML = ICON.plus;
            fab.hidden = true;
            fab.onclick = openSheet;
            document.body.append(fab);
        }

        ensureToolbar();

        fab.hidden = !subject;
        toolbar.hidden = !subject;
        document.body.classList.toggle("mh-has-fab", Boolean(subject));

        if (!subject) arranging = false;

        if (!busy) {
            if (!subject) {
                for (const dialog of [sheet, editDialog, replaceDialog, confirmDialog]) {
                    if (dialog.open) dialog.close();
                }
            } else if (sheet.open && subject.key !== sheetKey) {
                sheet.close();
            }
        }
    }

    /* Sign-in state changed: refresh the controls and the cards. */
    function setSession(next) {
    const was = Boolean(session);
    session = next;
    saveSession(next);

        if (!next) {
            queue = [];
            sheetKey = null;
            replaceState = null;
        }

        syncAdmin();

        if (was !== Boolean(next)) rerender();
    }

    /* Run after every page change made by the website. */
    if (typeof render === "function") {
        const baseRender = render;

        render = function () {
            const result = baseRender.apply(this, arguments);
            syncAdmin();
            return result;
        };
    }

    /* ---------- Pop-over menu (⋮ on cards, account) ---------- */
    let menuLayer = null;
    let menuAnchor = null;

    function closeMenu() {
        menuLayer?.remove();
        menuLayer = null;
        menuAnchor?.setAttribute("aria-expanded", "false");
        menuAnchor = null;
    }

    function openMenu(anchor, spec) {
        const same = menuAnchor === anchor;
        closeMenu();
        if (same) return;

        const layer = el("div", "mh-menu-layer");
        const menu = el("div", "mh-menu");
        menu.setAttribute("role", "menu");

        if (spec.header) {
            const head = el("div", "mh-menu-head");

            if (spec.header.avatar) {
                head.append(el("div", "mh-avatar", spec.header.avatar));
            }

            const text = el("div");
            text.append(
                el("strong", "", spec.header.title),
                el("span", "", spec.header.sub || "")
            );
            head.append(text);
            menu.append(head);
        }

        for (const item of spec.items || []) {
            const button = el("button", "mh-menu-item" +
                (item.danger ? " is-danger" : ""));
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.disabled = Boolean(item.disabled);
            button.innerHTML = item.icon || "";
            button.append(el("span", "", item.label));
            button.onclick = () => {
                closeMenu();
                item.run();
            };
            menu.append(button);
        }

        if (spec.note) menu.append(el("p", "mh-menu-note", spec.note));

        layer.append(menu);
        layer.addEventListener("pointerdown", event => {
            if (event.target === layer) closeMenu();
        });

        document.body.append(layer);
        menuLayer = layer;
        menuAnchor = anchor;
        anchor.setAttribute("aria-expanded", "true");

        /* Anchored pop-over on tablets and desktops (phones use CSS). */
        const rect = anchor.getBoundingClientRect();
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = Math.min(
            Math.max(8, rect.right - width),
            innerWidth - width - 8
        );
        let top = rect.bottom + 6;

        if (top + height > innerHeight - 8) top = rect.top - height - 6;

        menu.style.left = left + "px";
        menu.style.top = Math.max(8, top) + "px";

        menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    }

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && menuLayer) {
            const anchor = menuAnchor;
            closeMenu();
            anchor?.focus?.();
        }
    });

    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, { capture: true, passive: true });

    function openAccountMenu() {
        const email = session?.user?.email || "Admin";

        openMenu(acct, {
            header: {
                avatar: email.charAt(0).toUpperCase(),
                title: email,
                sub: "Admin account"
            },
            items: [
                {
                    label: "Refresh lectures",
                    icon: ICON.refresh,
                    run: async () => {
                        if (busy || saving) return;
                        const ok = await refreshLectures();
                        toast(
                            ok ? "Lectures are up to date." : "Could not refresh lectures.",
                            ok ? "success" : "error"
                        );
                    }
                },
                { label: "Sign out", icon: ICON.logout, run: signOut }
            ]
        });
    }

    function menuForCard(item, position, total) {
        if (!item.row) {
            return {
                header: { title: item.title, sub: "Original lecture · GitHub" },
                items: [],
                note:
                    "This PDF is hosted in your GitHub repository, so it can't " +
                    "be edited, re-ordered or deleted from here. To change it, " +
                    "update the PDF and its entry in index.html on GitHub."
            };
        }

        return {
            header: { title: item.title, sub: "Uploaded lecture" },
            items: [
                { label: "Edit details", icon: ICON.edit, run: () => openEdit(item.row) },
                { label: "Replace PDF", icon: ICON.replace, run: () => openReplace(item.row) },
                {
                    label: "Move earlier",
                    icon: ICON.up,
                    disabled: position === 0,
                    run: () => moveLecture(item.row.id, -1)
                },
                {
                    label: "Move later",
                    icon: ICON.down,
                    disabled: position === total - 1,
                    run: () => moveLecture(item.row.id, 1)
                },
                { label: "Delete lecture", icon: ICON.trash, danger: true, run: () => openDelete(item.row) }
            ]
        };
    }

    /* ---------- Supabase requests ---------- */
    async function request(path, options = {}) {
        const controller = new AbortController();

        const timer = setTimeout(
            () => controller.abort(),
            120000
        );

        try {
            const response = await fetch(SUPABASE_URL + path, {
                method: options.method || "GET",
                body: options.body,
                cache: "no-store",
                signal: controller.signal,
                headers: {
                    apikey: PUBLIC_KEY,
                    ...(options.token
                        ? { Authorization: "Bearer " + options.token }
                        : {}),
                    ...options.headers
                }
            });

            const text = await response.text();
            let data;

            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }

            if (!response.ok) {
                throw new Error(
                    data?.msg ||
                    data?.message ||
                    data?.error_description ||
                    data?.error ||
                    "Request failed: " + response.status
                );
            }

            return data;
        } catch (error) {
            if (error.name === "AbortError") {
                throw new Error(
                    "Request timed out. Check your connection and try again."
                );
            }

            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    /* Upload with a progress callback and a timeout suited to large PDFs. */
    function uploadPDF(path, file, token, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.open(
                "POST",
                SUPABASE_URL + "/storage/v1/object/" + BUCKET + "/" + encodePath(path)
            );

            xhr.setRequestHeader("apikey", PUBLIC_KEY);
            xhr.setRequestHeader("Authorization", "Bearer " + token);
            xhr.setRequestHeader("Content-Type", "application/pdf");
            xhr.setRequestHeader("x-upsert", "false");
            xhr.timeout = 15 * 60 * 1000;

            xhr.upload.onprogress = event => {
                if (event.lengthComputable) {
                    onProgress(event.loaded / event.total);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) return resolve();

                let detail;

                try {
                    const data = JSON.parse(xhr.responseText);
                    detail = data.message || data.error || data.msg;
                } catch {}

                reject(new Error(
                    detail ||
                    (xhr.status === 403 || xhr.status === 401
                        ? "Not allowed to upload. Check the Supabase storage policies."
                        : "Upload failed: " + xhr.status)
                ));
            };

            xhr.onerror = () => reject(new Error(
                "Network error. Check your connection and try again."
            ));

            xhr.ontimeout = () => reject(new Error(
                "The upload took too long. Check your connection and try again."
            ));

            xhr.send(file);
        });
    }

    async function accessToken() {
        if (!session) throw new Error("Please sign in again.");

        if (Date.now() > session.expires - 60000) {
            if (!refreshing) {
                const refreshToken = session.refresh_token;

                refreshing = request(
                    "/auth/v1/token?grant_type=refresh_token",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ refresh_token: refreshToken })
                    }
                )
                    .then(data => {
    setSession({
        ...data,
        user: data.user || session.user,
        expires: Date.now() + data.expires_in * 1000
    });
})
                    .finally(() => { refreshing = null; });
            }

            try {
                await refreshing;
            } catch {
                setSession(null);

                throw new Error(
                    "Your session ended. Open #admin to sign in again."
                );
            }
        }

        return session.access_token;
    }

    /* PATCH / DELETE on the lectures table. Row-level security hides rows
       the caller may not change, so an empty result means "not allowed". */
    async function changeRow(method, id, fields) {
        const rows = await request(
            "/rest/v1/lectures?id=eq." + encodeURIComponent(id),
            {
                method,
                token: await accessToken(),
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "return=representation"
                },
                body: fields ? JSON.stringify(fields) : undefined
            }
        );

        if (!Array.isArray(rows) || !rows.length) {
            throw new Error(
                "The change was not saved. Your account may not have " +
                "permission, or the lecture no longer exists."
            );
        }

        return rows[0];
    }

    async function removeStoredFile(path) {
        await request(
            "/storage/v1/object/" + BUCKET + "/" + encodePath(path),
            { method: "DELETE", token: await accessToken() }
        );
    }

    /* ---------- Sign in and out ---------- */
    function openAdmin() {
        if (location.hash !== "#admin") return;

        if (dialogs.some(dialog => dialog !== loginDialog && dialog.open)) return;

        $("mh-login").hidden = Boolean(session);
        $("mh-account").hidden = !session;

        if (session) {
            const email = session.user?.email || "Admin";
            $("mh-account-email").textContent = email;
            $("mh-avatar").textContent = email.charAt(0).toUpperCase();
        }

        message($("mh-login-error"), "");

        if (!loginDialog.open) openModal(loginDialog);

        if (!session) $("mh-email").focus();
    }

    window.addEventListener("hashchange", openAdmin);
    openAdmin();

    $("mh-login-close").onclick = () => loginDialog.close();
    $("mh-account-done").onclick = () => loginDialog.close();

    $("mh-pw-toggle").onclick = () => {
        const input = $("mh-password");
        const show = input.type === "password";

        input.type = show ? "text" : "password";
        $("mh-pw-toggle").innerHTML = show ? ICON.eyeOff : ICON.eye;
        $("mh-pw-toggle").setAttribute("aria-pressed", String(show));
        $("mh-pw-toggle").setAttribute(
            "aria-label",
            show ? "Hide password" : "Show password"
        );
    };

    $("mh-login").onsubmit = async event => {
        event.preventDefault();

        setBusyButton($("mh-signin"), true, "Signing in…");
        $("mh-signin").disabled = true;
        message($("mh-login-error"), "");

        try {
            const data = await request(
                "/auth/v1/token?grant_type=password",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: $("mh-email").value.trim(),
                        password: $("mh-password").value
                    })
                }
            );

            $("mh-password").value = "";

            if (!isAdmin(data.user?.id)) {
                request("/auth/v1/logout", {
                    method: "POST",
                    token: data.access_token
                }).catch(() => {});

                throw new Error(
                    "This account does not have admin access."
                );
            }

            loginDialog.close();

            setSession({
                ...data,
                expires: Date.now() + data.expires_in * 1000
            });

            toast(
                currentSubject()
                    ? "Signed in. Tap + to add lectures."
                    : "Signed in. Open a subject to manage its lectures.",
                "success"
            );
        } catch (error) {
            message($("mh-login-error"), error.message);
        } finally {
            setBusyButton($("mh-signin"), false, "Sign in");
            $("mh-signin").disabled = false;
        }
    };

    function signOut() {
        if (busy || saving) {
            return toast("Wait for the current save to finish, then sign out.");
        }

        const token = session?.access_token;

        for (const dialog of dialogs) if (dialog.open) dialog.close();

        setSession(null);
        toast("Signed out.");

        if (token) {
            request("/auth/v1/logout", {
                method: "POST",
                token
            }).catch(() => {});
        }
    }

    $("mh-signout").onclick = signOut;

    /* ---------- PDF preview (pdf.js, loaded only when needed) ---------- */
    let pdfjsPromise = null;
    let previewToken = 0;
    let previewUrl = null;
    let previewDoc = null;

    // Use the existing local PDF.js build when possible. On devices where it
    // cannot initialize, retry with a matching hosted API + worker pair.
    const PREVIEW_PDFJS_CDN =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/";

    function loadPdfJs(useFallback = false) {
        if (!useFallback && window.pdfjsLib) {
            return Promise.resolve(window.pdfjsLib);
        }

        if (useFallback) {
            return import(PREVIEW_PDFJS_CDN + "pdf.min.mjs")
                .then(pdfjs => {
                    pdfjs.GlobalWorkerOptions.workerSrc =
                        PREVIEW_PDFJS_CDN + "pdf.worker.min.mjs";
                    return pdfjs;
                });
        }

        if (!pdfjsPromise) {
            pdfjsPromise = import("./pdfjs/build/pdf.mjs")
                .then(pdfjs => {
                    pdfjs.GlobalWorkerOptions.workerSrc =
                        "./pdfjs/build/pdf.worker.mjs";
                    window.pdfjsLib = pdfjs;
                    return pdfjs;
                })
                .catch(error => {
                    console.warn("Local PDF preview engine unavailable:", error);
                    pdfjsPromise = null;
                    return loadPdfJs(true);
                });
        }

        return pdfjsPromise;
    }

    function cleanupPreview() {
        previewToken++;

        if (previewDoc) {
            previewDoc.destroy?.();
            previewDoc = null;
        }

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        $("mh-prev-body").replaceChildren();
    }

    previewDialog.addEventListener("close", cleanupPreview);
    $("mh-prev-x").onclick = () => previewDialog.close();
    $("mh-prev-close").onclick = () => previewDialog.close();

    async function previewPDF(file, title) {
        cleanupPreview();

        const token = ++previewToken;
        const body = $("mh-prev-body");

        $("mh-prev-title").textContent = title || file.name;
        $("mh-prev-sub").textContent = file.name + " · " + formatSize(file.size);

        const wait = el("div", "mh-prev-wait");
        wait.append(el("span", "mh-spinner is-dark"), el("span", "", "Preparing preview…"));
        body.replaceChildren(wait);

        previewUrl = URL.createObjectURL(file);
        $("mh-prev-open").href = previewUrl;
        openModal(previewDialog);

        // Rendering a large number of full-page canvases can exhaust Android
        // tablet memory. Show the first few pages on touch devices instead.
        const isTabletOrPhone = matchMedia("(pointer: coarse)").matches;
        const pageLimit = isTabletOrPhone ? 6 : MAX_PREVIEW_PAGES;
        const pixelRatio = isTabletOrPhone
            ? Math.min(window.devicePixelRatio || 1, 1.25)
            : Math.min(window.devicePixelRatio || 1, 2);

        async function renderWith(pdfjs) {
            const data = await file.arrayBuffer();
            if (token !== previewToken) return;

            const task = pdfjs.getDocument({ data: new Uint8Array(data) });
            const doc = await task.promise;
            if (token !== previewToken) {
                await doc.destroy();
                return;
            }

            previewDoc = doc;
            body.replaceChildren();
            const width = Math.max(body.clientWidth - 28, 280);
            const pages = Math.min(doc.numPages, pageLimit);

            for (let number = 1; number <= pages; number++) {
                if (token !== previewToken) return;
                const page = await doc.getPage(number);
                const base = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({
                    scale: (width * pixelRatio) / base.width
                });
                const canvas = document.createElement("canvas");
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                canvas.setAttribute("aria-label", "Page " + number + " of " + doc.numPages);
                body.append(canvas);
                await page.render({
                    canvasContext: canvas.getContext("2d"),
                    viewport
                }).promise;
                page.cleanup?.();
            }

            if (doc.numPages > pages) {
                body.append(el(
                    "p", "mh-prev-more",
                    "Previewing the first " + pages + " of " + doc.numPages +
                    " pages. Use “Open in new tab” for the full PDF."
                ));
            }
        }

        try {
            await renderWith(await loadPdfJs());
        } catch (firstError) {
            if (token !== previewToken) return;
            console.warn("PDF preview render failed; retrying:", firstError);
            // If the local PDF.js engine fails on Samsung Chrome, retry with
            // the matching hosted version rather than an Android blob iframe.
            try {
                if (previewDoc) {
                    await previewDoc.destroy?.().catch?.(() => {});
                    previewDoc = null;
                }
                body.replaceChildren(wait);
                await renderWith(await loadPdfJs(true));
            } catch (secondError) {
                if (token !== previewToken) return;
                console.error("PDF preview unavailable:", secondError);
                body.replaceChildren();
                const errorMessage = el(
                    "div", "mh-prev-wait",
                    "Preview unavailable in this browser. Tap “Open in new tab” below to view the PDF."
                );
                body.append(errorMessage);
            }
        }
    }

    /* ---------- Upload sheet ---------- */
    function renderDestination(node, subject, lecture) {
        node.replaceChildren();
        node.insertAdjacentHTML("beforeend", ICON.folder);

        const parts = [
            "Stage " + subject.stage,
            subject.blockLabel,
            subject.name
        ];

        if (lecture) parts.push(lecture);

        for (const text of parts) {
            node.append(el("span", "", text));
        }
    }

    function updateDropBox() {
        const has = queue.length > 0;

        $("mh-drop").classList.toggle("is-compact", has);
        $("mh-drop-title").textContent = has ? "Add more PDFs" : "Choose PDFs";
        $("mh-drop-sub").textContent = has
            ? queue.length + " selected · up to " + MAX_FILES + " per batch"
            : "Tap to browse. Pick several at once. Up to 50 MB each.";
    }

    function updatePublishLabel() {
        if (busy) return;

        const label = queue.length > 1
            ? "Publish " + queue.length + " lectures"
            : "Publish lecture";

        $("mh-publish").querySelector(".mh-btn-text").textContent = label;
        $("mh-sheet-title").textContent =
            queue.length > 1 ? "Add lectures" : "Add a lecture";
    }

    function resetQueue() {
        queue = [];
        $("mh-queue").replaceChildren();
        $("mh-file").value = "";
        message($("mh-status"), "");
        $("mh-summary").hidden = true;
        updateDropBox();
        updatePublishLabel();
    }

    function openSheet() {
        const subject = currentSubject();

        if (!session || !subject) return;

        if (sheetKey !== subject.key) {
            resetQueue();
            sheetKey = subject.key;
        }

        renderDestination($("mh-dest"), subject);
        message($("mh-status"), "");

        openModal(sheet);
    }

    $("mh-sheet-close").onclick = () => sheet.close();
    $("mh-cancel").onclick = () => sheet.close();

    // A dismissed upload sheet must never keep unpublished PDF drafts.
    // Covers Cancel, the X button, backdrop taps and navigation away.
    sheet.addEventListener("close", () => {
        if (busy) return;
        closeLectureTypePickers();
        resetQueue();
        sheetKey = null;
    });

    function setItemState(item, state, value, text) {
        const node = item.node;
        node.dataset.state = state;

        const progress = node.querySelector(".mh-qprog");
        const bar = node.querySelector(".mh-bar span");
        const label = node.querySelector(".mh-qstate");

        progress.hidden = state === "queued";

        if (state === "uploading") {
            const percent = Math.round((value || 0) * 100);
            bar.style.width = percent + "%";
            label.textContent = "Uploading… " + percent + "%";
        } else if (state === "saving") {
            bar.style.width = "100%";
            label.textContent = "Saving details…";
        } else if (state === "done") {
            bar.style.width = "100%";
            label.textContent = "Published";
        } else if (state === "error") {
            label.textContent = text || "Something went wrong.";
        }
    }

    /* ---------- Polished lecture-type picker (upload queue only) ---------- */
    function closeLectureTypePickers(except = null) {
        document.querySelectorAll(".mh-type-picker.is-open").forEach(picker => {
            if (picker === except) return;
            picker.classList.remove("is-open");
            const trigger = picker.querySelector(".mh-type-trigger");
            if (trigger) trigger.setAttribute("aria-expanded", "false");
        });
    }

    function decorateLectureTypeSelect(select) {
        const picker = el("div", "mh-type-picker");
        const trigger = el("button", "mh-type-trigger");
        const menu = el("div", "mh-type-options");
        const label = el("span", "mh-type-current", select.value || TYPES[0]);

        trigger.type = "button";
        trigger.setAttribute("aria-label", "Choose lecture type");
        trigger.setAttribute("aria-expanded", "false");
        trigger.append(label);
        trigger.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>');
        menu.setAttribute("aria-label", "Lecture types");

        const redraw = () => {
            label.textContent = select.value;
            menu.querySelectorAll(".mh-type-option").forEach(option => {
                const chosen = option.dataset.value === select.value;
                option.classList.toggle("is-selected", chosen);
                option.setAttribute("aria-pressed", String(chosen));
            });
        };

        for (const type of TYPES) {
            const option = el("button", "mh-type-option");
            option.type = "button";
            option.dataset.value = type;
            option.append(el("span", "", type));
            option.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>');
            option.addEventListener("click", () => {
                if (select.value !== type) {
                    select.value = type;
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
                redraw();
                closeLectureTypePickers();
                trigger.focus({ preventScroll: true });
            });
            menu.append(option);
        }

        trigger.addEventListener("click", () => {
            const opening = !picker.classList.contains("is-open");
            closeLectureTypePickers();
            picker.classList.toggle("is-open", opening);
            trigger.setAttribute("aria-expanded", String(opening));
            if (opening) {
                trigger.scrollIntoView({ block: "nearest", behavior: "instant" });
            }
        });
        trigger.addEventListener("keydown", event => {
            if (event.key === "ArrowDown" && !picker.classList.contains("is-open")) {
                event.preventDefault();
                trigger.click();
            }
            if (event.key === "Escape") closeLectureTypePickers();
        });
        menu.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeLectureTypePickers();
                trigger.focus();
            }
        });
        select.addEventListener("change", redraw);
        select.classList.add("mh-type-native");
        select.setAttribute("aria-hidden", "true");
        select.tabIndex = -1;
        select.parentNode.insertBefore(picker, select);
        picker.append(select, trigger, menu);
        redraw();
    }

    document.addEventListener("pointerdown", event => {
        if (!event.target.closest(".mh-type-picker")) closeLectureTypePickers();
    });

    function buildQueueItem(file) {
        const item = {
            id: ++queueId,
            file,
            title: titleFromName(file.name),
            category: TYPES[0],
            description: "",
            lectureDate: "",
            path: null,
            rowId: null,
            order: null,
            uploaded: false,
            checked: false,
            done: false,
            node: null
        };

        const node = el("article", "mh-qitem");
        node.dataset.state = "queued";
        node.dataset.id = String(item.id);
        node.innerHTML = `
            <div class="mh-qhead">
                <span class="mh-qicon">${ICON.file}</span>
                <div class="mh-qmeta">
                    <strong class="mh-qname"></strong>
                    <small></small>
                </div>
                <button type="button" class="mh-icon-btn mh-sm" data-act="preview"
                    aria-label="Preview PDF">${ICON.eye}</button>
                <button type="button" class="mh-icon-btn mh-sm" data-act="remove"
                    aria-label="Remove from list">${ICON.close}</button>
            </div>
            <label class="mh-field">
                <span class="mh-flabel">Title</span>
                <input type="text" class="mh-qtitle" maxlength="200"
                    autocomplete="off" placeholder="Lecture title">
            </label>
            <div class="mh-qrow">
                <label class="mh-field">
                    <span class="mh-flabel">Type</span>
                    <select class="mh-select mh-qcat"></select>
                </label>
                <label class="mh-field">
                    <span class="mh-flabel">Label<span class="mh-opt">Optional</span></span>
                    <input type="text" class="mh-qdesc" maxlength="200"
                        autocomplete="off" placeholder="e.g. Lab 8">
                </label>
            </div>
            <label class="mh-field mh-date-field">
                <span class="mh-flabel">Lecture date <span class="mh-opt">Optional · actual teaching date</span></span>
                <input type="date" class="mh-qdate" aria-label="Actual lecture date">
            </label>
            <div class="mh-qprog" hidden>
                <div class="mh-bar"><span></span></div>
                <small class="mh-qstate"></small>
            </div>
        `;

        node.querySelector(".mh-qname").textContent = file.name;
        node.querySelector("small").textContent = formatSize(file.size);
        node.querySelector(".mh-qtitle").value = item.title;

        const select = node.querySelector(".mh-qcat");
        for (const type of TYPES) select.append(new Option(type, type));
        decorateLectureTypeSelect(select);

        item.node = node;
        return item;
    }

    function addFiles(files) {
        const problems = [];

        for (const file of files) {
            if (queue.length >= MAX_FILES) {
                problems.push("Only " + MAX_FILES + " PDFs can be added at a time.");
                break;
            }

            if (!isPDFFile(file)) {
                problems.push(file.name + " is not a PDF.");
                continue;
            }

            if (!file.size || file.size > MAX_BYTES) {
                problems.push(file.name + " is empty or larger than 50 MB.");
                continue;
            }

            if (queue.some(entry =>
                entry.file.name === file.name &&
                entry.file.size === file.size &&
                entry.file.lastModified === file.lastModified
            )) continue;

            const item = buildQueueItem(file);
            queue.push(item);
            $("mh-queue").append(item.node);
        }

        message($("mh-status"), problems.join(" "));
        $("mh-summary").hidden = true;
        updateDropBox();
        updatePublishLabel();
    }

    $("mh-file").addEventListener("change", () => {
        const files = [...$("mh-file").files];

        /* Reset so the same file can be picked again after removing it. */
        $("mh-file").value = "";

        if (files.length) addFiles(files);
    });

    /* Edits and buttons inside the queue. */
    function itemFrom(target) {
        const node = target.closest(".mh-qitem");
        return node && queue.find(item => item.node === node);
    }

    $("mh-queue").addEventListener("input", event => {
        const item = itemFrom(event.target);
        if (!item) return;

        if (event.target.classList.contains("mh-qtitle")) {
            item.title = event.target.value;
            event.target.removeAttribute("aria-invalid");
        } else if (event.target.classList.contains("mh-qdesc")) {
            item.description = event.target.value;
        }
    });

    $("mh-queue").addEventListener("change", event => {
        const item = itemFrom(event.target);

        if (!item) return;
        if (event.target.classList.contains("mh-qcat")) {
            item.category = event.target.value;
        } else if (event.target.classList.contains("mh-qdate")) {
            item.lectureDate = event.target.value;
        }
    });

    $("mh-queue").addEventListener("click", event => {
        const button = event.target.closest("button[data-act]");
        const item = button && itemFrom(button);

        if (!item || busy) return;

        if (button.dataset.act === "preview") {
            previewPDF(item.file, item.title.trim() || item.file.name);
        } else if (button.dataset.act === "remove") {
            queue = queue.filter(entry => entry !== item);
            item.node.remove();
            updateDropBox();
            updatePublishLabel();
        }
    });

    const drop = $("mh-drop");

    ["dragenter", "dragover"].forEach(name =>
        drop.addEventListener(name, event => {
            event.preventDefault();
            drop.classList.add("is-over");
        })
    );

    ["dragleave", "drop"].forEach(name =>
        drop.addEventListener(name, () => drop.classList.remove("is-over"))
    );

    drop.addEventListener("drop", event => {
        event.preventDefault();

        const files = [...(event.dataTransfer?.files || [])];

        if (files.length) addFiles(files);
    });

    /* New lectures go after the existing ones in this subject. */
    function nextOrder(subject) {
        let highest = -1;

        for (const row of rowsFor(subject)) {
            const order = Number(row.sort_order);

            if (Number.isFinite(order)) highest = Math.max(highest, order);
        }

        return highest + 1;
    }

    async function hasPDFHeader(file) {
        const header = new TextDecoder().decode(
            await file.slice(0, 1024).arrayBuffer()
        );

        return header.includes("%PDF-");
    }

    /* Upload one PDF, then save its lecture details. Safe to retry. */
    async function publishItem(item, subject) {
        try {
            if (!item.checked) {
                if (!(await hasPDFHeader(item.file))) {
                    throw new Error("This file does not appear to be a PDF.");
                }

                item.checked = true;
            }

            const token = await accessToken();

            if (!item.path) {
                item.path = session.user.id + "/" + crypto.randomUUID() + ".pdf";
                item.rowId = crypto.randomUUID();
            }

            if (!item.uploaded) {
                setItemState(item, "uploading", 0);

                await uploadPDF(item.path, item.file, token, fraction =>
                    setItemState(item, "uploading", fraction)
                );

                item.uploaded = true;
            }

            setItemState(item, "saving");

            await request("/rest/v1/lectures?on_conflict=id", {
                method: "POST",
                token: await accessToken(),
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "resolution=ignore-duplicates,return=minimal"
                },
                body: JSON.stringify({
                    id: item.rowId,
                    title: item.title.trim(),
                    stage: subject.stage,
                    block: subject.block,
                    subject: subject.key,
                    category: item.category,
                    description: item.description.trim(),
                    lecture_date: item.lectureDate || null,
                    file_size_bytes: item.file.size,
                    sort_order: item.order,
                    file_path: item.path
                })
            });

            item.done = true;
            setItemState(item, "done");
        } catch (error) {
            setItemState(
                item,
                "error",
                0,
                error.message +
                (item.uploaded
                    ? " The PDF is uploaded; press Publish to retry saving its details."
                    : "")
            );
        }
    }

    async function runPool(items, size, worker) {
        let next = 0;

        await Promise.all(
            Array.from({ length: Math.min(size, items.length) }, async () => {
                while (next < items.length) await worker(items[next++]);
            })
        );
    }

    function setSheetBusy(on) {
        busy = on;

        for (const control of $("mh-upload").elements) {
            control.disabled = on;
        }

        $("mh-sheet-close").disabled = on;
        $("mh-drop").style.pointerEvents = on ? "none" : "";
        $("mh-drop").style.opacity = on ? "0.6" : "";

        setBusyButton(
            $("mh-publish"),
            on,
            on ? "Publishing…" : "Publish lecture"
        );

        if (!on) updatePublishLabel();
    }

    $("mh-upload").onsubmit = async event => {
        event.preventDefault();
        if (busy) return;

        const subject = currentSubject();

        if (!session || !subject || subject.key !== sheetKey) {
            return message(
                $("mh-status"),
                "Open the subject's lecture page and try again."
            );
        }

        if (!queue.length) {
            return message($("mh-status"), "Choose at least one PDF to upload.");
        }

        const missing = queue.find(item => !item.title.trim());

        if (missing) {
            const input = missing.node.querySelector(".mh-qtitle");
            input.setAttribute("aria-invalid", "true");
            input.focus();
            return message($("mh-status"), "Every lecture needs a title.");
        }

        message($("mh-status"), "");
        $("mh-summary").hidden = true;

        const base = nextOrder(subject);

        queue.forEach((item, index) => {
            if (item.order == null) item.order = Math.min(base + index, 100000);
        });

        const batch = queue.slice();
        let finished = 0;

        $("mh-summary").hidden = false;
        $("mh-summary").textContent = "0 of " + batch.length + " finished";

        setSheetBusy(true);

        await runPool(batch, CONCURRENCY, async item => {
            await publishItem(item, subject);
            finished++;
            $("mh-summary").textContent =
                finished + " of " + batch.length + " finished";
        });

        setSheetBusy(false);

        const published = batch.filter(item => item.done);
        const failed = batch.filter(item => !item.done);

        queue = queue.filter(item => !item.done);
        published.forEach(item => item.node.remove());

        updateDropBox();
        updatePublishLabel();

        if (failed.length) {
            message(
                $("mh-status"),
                (published.length
                    ? published.length + " published, " + failed.length + " failed. "
                    : "Nothing was published. ") +
                "Fix the problems below, then press Publish again to retry.",
                "error"
            );
        } else {
            resetQueue();
            sheetKey = null;
            sheet.close();
        }

        if (!published.length) return;

        while (loading) {
            await new Promise(resolve => setTimeout(resolve, 120));
        }

        const refreshed = await refreshLectures();
        const noun = published.length === 1
            ? "“" + published[0].title.trim() + "”"
            : published.length + " lectures";

        if (refreshed) {
            toast("Published. " + noun + " added to " + subject.name + ".", "success");
            highlight(pdfURL(published[published.length - 1].path));
        } else {
            toast("Published. Refresh the page to see the new lectures.", "success");
        }
    };

    function highlight(url, className = "mh-new") {
        requestAnimationFrame(() => {
            const card = [...$("resource-grid").children]
                .find(item => item.dataset.url === url);

            if (!card) return;

            card.scrollIntoView({
                behavior: reduceMotion.matches ? "auto" : "smooth",
                block: "center"
            });

            card.classList.add(className);
            setTimeout(() => card.classList.remove(className), 4000);
        });
    }

    /* ---------- Edit details ---------- */
    function buildEditChips(selected) {
        const types = TYPES.includes(selected) || !selected
            ? TYPES
            : [...TYPES, selected];

        const wrap = $("mh-edit-types");
        wrap.replaceChildren();

        for (const type of types) {
            const label = el("label", "mh-chip");
            const input = document.createElement("input");
            input.type = "radio";
            input.name = "mh-edit-category";
            input.value = type;
            input.checked = type === (selected || TYPES[0]);

            label.append(input, el("span", "", type));
            wrap.append(label);
        }
    }

    function openEdit(row) {
        const subject = currentSubject();
        if (!subject) return;

        editRow = row;
        $("mh-edit-title").value = row.title || "";
        $("mh-edit-title").removeAttribute("aria-invalid");
        $("mh-edit-desc").value = row.description || "";
        $("mh-edit-date").value = row.lecture_date || "";
        buildEditChips(row.category);
        message($("mh-edit-status"), "");
        renderDestination($("mh-edit-dest"), subject);

        openModal(editDialog);
    }

    $("mh-edit-close").onclick = () => editDialog.close();
    $("mh-edit-cancel").onclick = () => editDialog.close();

    $("mh-edit").onsubmit = async event => {
        event.preventDefault();
        if (busy || !editRow) return;

        const row = editRow;
        const title = $("mh-edit-title").value.trim();
        const description = $("mh-edit-desc").value.trim();
        const lectureDate = $("mh-edit-date").value || null;
        const category = $("mh-edit")
            .querySelector('input[name="mh-edit-category"]:checked')?.value ||
            row.category;

        if (!title) {
            $("mh-edit-title").setAttribute("aria-invalid", "true");
            $("mh-edit-title").focus();
            return message($("mh-edit-status"), "Enter the lecture title.");
        }

        if (
            title === row.title &&
            description === (row.description || "") &&
            lectureDate === (row.lecture_date || null) &&
            category === row.category
        ) {
            return editDialog.close();
        }

        busy = true;
        setBusyButton($("mh-edit-save"), true, "Saving…");
        for (const control of $("mh-edit").elements) control.disabled = true;
        message($("mh-edit-status"), "");

        try {
            const saved = await changeRow("PATCH", row.id, {
                title,
                category,
                description,
                lecture_date: lectureDate
            });

            Object.assign(row, saved);
            applyRows();
            busy = false;
            editDialog.close();
            rerender();
            toast("Lecture details saved.", "success");
            highlight(pdfURL(row.file_path), "mh-moved");
        } catch (error) {
            message($("mh-edit-status"), error.message);
        } finally {
            busy = false;
            setBusyButton($("mh-edit-save"), false, "Save changes");
            for (const control of $("mh-edit").elements) control.disabled = false;
        }
    };

    /* ---------- Delete (database row AND the stored PDF) ---------- */
    function openDelete(row) {
        deleteRow = row;
        $("mh-confirm-name").textContent = row.title;
        message($("mh-confirm-status"), "");
        openModal(confirmDialog);
        $("mh-confirm-cancel").focus();
    }

    $("mh-confirm-cancel").onclick = () => confirmDialog.close();

    $("mh-confirm-delete").onclick = async () => {
        if (busy || !deleteRow) return;

        const row = deleteRow;

        busy = true;
        $("mh-confirm-cancel").disabled = true;
        $("mh-confirm-delete").disabled = true;
        setBusyButton($("mh-confirm-delete"), true, "Deleting…");
        message($("mh-confirm-status"), "");

        let fileWarning = "";

        try {
            /* 1. Remove the lecture so students stop seeing it. */
            await changeRow("DELETE", row.id);

            lastRows = lastRows.filter(item => item.id !== row.id);
            applyRows();

            /* 2. Remove the PDF from storage. */
            if (safeStoragePath(row.file_path)) {
                try {
                    await removeStoredFile(row.file_path);
                } catch (error) {
                    fileWarning = error.message;
                }
            }

            busy = false;
            confirmDialog.close();
            deleteRow = null;
            rerender();

            toast(
                fileWarning
                    ? "Lecture deleted, but its PDF file could not be removed from storage: " + fileWarning
                    : "Lecture and its PDF file deleted.",
                fileWarning ? "error" : "success"
            );
        } catch (error) {
            message($("mh-confirm-status"), error.message);
        } finally {
            busy = false;
            $("mh-confirm-cancel").disabled = false;
            $("mh-confirm-delete").disabled = false;
            setBusyButton($("mh-confirm-delete"), false, "Delete");
        }
    };

    /* ---------- Replace a PDF, keep the lecture details ---------- */
    function updateReplaceBox() {
        const file = $("mh-rfile").files[0];

        $("mh-rdrop").classList.toggle("has-file", Boolean(file));
        $("mh-rdrop-icon").innerHTML = file ? ICON.check : ICON.pdf;
        $("mh-rdrop-title").textContent = file ? file.name : "Choose the new PDF";
        $("mh-rdrop-sub").textContent = file
            ? formatSize(file.size) + ". Tap to change."
            : "Tap to browse. Up to 50 MB.";
        $("mh-rpreview").hidden = !file;
    }

    function openReplace(row) {
        const subject = currentSubject();
        if (!subject) return;

        replaceRow = row;
        replaceState = null;
        $("mh-rfile").value = "";
        updateReplaceBox();
        message($("mh-replace-status"), "");
        $("mh-rprogress").hidden = true;
        $("mh-rbar").style.width = "0";
        renderDestination($("mh-replace-dest"), subject, row.title);

        openModal(replaceDialog);
    }

    $("mh-replace-close").onclick = () => replaceDialog.close();
    $("mh-replace-cancel").onclick = () => replaceDialog.close();

    $("mh-rfile").addEventListener("change", () => {
        const file = $("mh-rfile").files[0];

        replaceState = null;
        message($("mh-replace-status"), "");

        if (file && (!isPDFFile(file) || !file.size || file.size > MAX_BYTES)) {
            $("mh-rfile").value = "";
            message(
                $("mh-replace-status"),
                !isPDFFile(file)
                    ? "Choose a PDF file."
                    : "Choose a PDF no larger than 50 MB."
            );
        }

        updateReplaceBox();
    });

    $("mh-rpreview").onclick = () => {
        const file = $("mh-rfile").files[0];

        if (file) previewPDF(file, replaceRow?.title);
    };

    $("mh-replace").onsubmit = async event => {
        event.preventDefault();
        if (busy || !replaceRow) return;

        const row = replaceRow;
        const file = $("mh-rfile").files[0];

        if (!file) {
            return message($("mh-replace-status"), "Choose the new PDF first.");
        }

        busy = true;
        for (const control of $("mh-replace").elements) control.disabled = true;
        setBusyButton($("mh-replace-save"), true, "Replacing…");
        message($("mh-replace-status"), "");

        const oldPath = row.file_path;
        let cleanupWarning = "";
        let newPath = null;

        try {
            if (!(await hasPDFHeader(file))) {
                throw new Error("This file does not appear to be a PDF.");
            }

            const token = await accessToken();

            /* A new file name means students never see a cached old copy,
               and a failed attempt can never damage the current PDF. */
            if (!replaceState || replaceState.file !== file) {
                replaceState = {
                    file,
                    path: session.user.id + "/" + crypto.randomUUID() + ".pdf",
                    uploaded: false
                };
            }

            if (!replaceState.uploaded) {
                $("mh-rprogress").hidden = false;
                $("mh-rprogress-text").textContent = "Uploading PDF… 0%";
                $("mh-rbar").style.width = "0";

                await uploadPDF(replaceState.path, file, token, fraction => {
                    const percent = Math.round(fraction * 100);
                    $("mh-rbar").style.width = percent + "%";
                    $("mh-rprogress-text").textContent =
                        "Uploading PDF… " + percent + "%";
                });

                replaceState.uploaded = true;
            }

            $("mh-rbar").style.width = "100%";
            $("mh-rprogress-text").textContent = "Switching the lecture to the new PDF…";

            newPath = replaceState.path;

            const saved = await changeRow("PATCH", row.id, { file_path: newPath });

            Object.assign(row, saved);

            /* Only now is the old PDF unused, so remove it. */
            if (safeStoragePath(oldPath) && oldPath !== newPath) {
                try {
                    await removeStoredFile(oldPath);
                } catch (error) {
                    cleanupWarning = error.message;
                }
            }

            applyRows();
            replaceState = null;
            busy = false;
            replaceDialog.close();
            rerender();

            toast(
                cleanupWarning
                    ? "PDF replaced, but the old file could not be removed from storage: " + cleanupWarning
                    : "PDF replaced. Lecture details were kept.",
                cleanupWarning ? "error" : "success"
            );

            highlight(pdfURL(newPath), "mh-moved");
        } catch (error) {
            message(
                $("mh-replace-status"),
                error.message +
                (replaceState?.uploaded
                    ? " The new PDF is uploaded; press Replace PDF to retry."
                    : "")
            );

            $("mh-rprogress").hidden = true;
        } finally {
            busy = false;
            for (const control of $("mh-replace").elements) control.disabled = false;
            setBusyButton($("mh-replace-save"), false, "Replace PDF");
        }
    };

    /* ---------- Re-order ---------- */
    async function moveLecture(id, direction) {
        if (saving || busy) return;

        const subject = currentSubject();
        if (!subject) return;

        const list = rowsFor(subject);
        const index = list.findIndex(row => row.id === id);
        const target = index + direction;

        if (index < 0 || target < 0 || target >= list.length) return;

        const reordered = list.slice();
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

        const changes = [];

        reordered.forEach((row, position) => {
            if (Number(row.sort_order) !== position) {
                changes.push({ row, position, before: row.sort_order });
            }
        });

        saving = true;

        /* Show the new order straight away; undo it if saving fails. */
        changes.forEach(change => { change.row.sort_order = change.position; });
        sortRows();
        applyRows();
        rerender();

        const moved = list[index];
        highlight(pdfURL(moved.file_path), "mh-moved");

        try {
            await Promise.all(
                changes.map(change =>
                    changeRow("PATCH", change.row.id, { sort_order: change.position })
                )
            );

            toast("Order saved.", "success");
        } catch (error) {
            changes.forEach(change => { change.row.sort_order = change.before; });
            sortRows();
            applyRows();
            toast("Could not save the new order: " + error.message, "error");
        } finally {
            saving = false;
            rerender();
        }
    }

    /* ---------- Lecture cards (rendered safely) ---------- */
    renderResources = function (items, group, subjectTitle) {
        const grid = $("resource-grid");
        grid.replaceChildren();

        const admin = Boolean(session);
        const uploaded = items.filter(item => item.row);

        items.forEach((item, index) => {
            const card = document.createElement("article");
            card.className = "resource-card" +
                (group === "bbb" ? " bbb-resource" : "");

            card.dataset.url = item.url;
            if (item.row) card.dataset.id = item.row.id;

            card.style.animationDelay =
                Math.min(index * 0.05, 0.5) + "s";

            function add(tag, className, text) {
                const node = document.createElement(tag);
                node.className = className;
                node.textContent = text;
                card.append(node);
                return node;
            }

            add("div", "resource-icon", "📄");

            const indexLabel = add(
                "div",
                "resource-index",
                "PDF " + String(index + 1).padStart(2, "0")
            );

            if (admin) {
                indexLabel.append(el(
                    "span",
                    "mh-src " + (item.row ? "is-up" : "is-orig"),
                    item.row ? "Uploaded" : "Original"
                ));
            }

            add("h3", "", item.title);
            add("p", "", item.description);

            const position = uploaded.indexOf(item);

            if (admin && arranging && item.row) {
                const bar = el("div", "mh-arrange");
                bar.append(el(
                    "span",
                    "",
                    "Position " + (position + 1) + " of " + uploaded.length
                ));

                const buttons = el("div");

                for (const [direction, glyph, label] of [
                    [-1, ICON.up, "Move earlier"],
                    [1, ICON.down, "Move later"]
                ]) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.innerHTML = glyph;
                    button.setAttribute("aria-label", label + ": " + item.title);
                    button.disabled = saving ||
                        (direction < 0 ? position === 0 : position === uploaded.length - 1);
                    button.onclick = () => moveLecture(item.row.id, direction);
                    buttons.append(button);
                }

                bar.append(buttons);
                card.append(bar);
            }

            const actions = add("div", "resource-actions", "");

            const open = document.createElement("a");
open.className = "btn-link btn-open";
open.textContent = "Open PDF";


// Keep the original PDF link as a fallback.
open.href = item.url;
open.target = "_blank";
open.rel = "noopener noreferrer";

try {
    const base = new URL("./", location.href);
    const source = new URL(item.url, base);

    // Use the NEW local PDF.js viewer.
    const viewer = new URL("reader/index.html", base);

    // Pass the actual PDF file to PDF.js.
    viewer.searchParams.set("file", source.href);

    open.href = viewer.href;
    open.target = "_blank";
    open.rel = "noopener noreferrer";

} catch (error) {
    console.warn("Using the original PDF link:", error);
}

const download = document.createElement("a");
download.className = "btn-link btn-download";
download.textContent = "Download";
download.href = item.downloadUrl || item.url;
download.download = makeFileName(item, subjectTitle);

if (typeof showDownloadState === "function") {
    download.addEventListener(
        "click",
        () => showDownloadState(download)
    );
}

actions.append(open, download);

if (admin) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "mh-more";
    more.innerHTML = ICON.more;
    more.setAttribute(
        "aria-label",
        "Lecture options: " + item.title
    );
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");

    more.onclick = event => {
        event.stopPropagation();
        openMenu(
            more,
            menuForCard(item, position, uploaded.length)
        );
    };

    card.append(more);
}

grid.append(card);

});

if (admin) {
    ensureToolbar();
    toolbar.hidden = !currentSubject();
    updateToolbar(items);
}
};

/* Fetch uploaded lectures without changing the original ones. */
async function refreshLectures() {
    if (loading) return false;

    loading = true;
    notice.textContent = "Checking for new lectures…";

    try {
        const rows = [];

        for (let offset = 0; ; offset += 1000) {
            const page = await request(
                "/rest/v1/lectures?select=*" +
                "&order=sort_order.asc,created_at.asc,id.asc" +
                "&limit=1000&offset=" + offset
            );

            if (!Array.isArray(page)) {
                throw new Error("Unexpected lecture response.");
            }

            rows.push(...page);
            if (page.length < 1000) break;
        }

        lastRows = rows;
        applyRows();
        rerender();

        notice.textContent = "";
        return true;

    } catch {
        notice.replaceChildren(
            document.createTextNode(
                "New lectures could not load. " +
                "Existing lectures are still available. "
            )
        );

        const retry = document.createElement("button");
        retry.id = "mh-retry";
        retry.textContent = "Retry";
        retry.onclick = refreshLectures;
        notice.append(retry);

        return false;

    } finally {
        loading = false;
    }
}

syncAdmin();
rerender();
refreshLectures();

/* Don't refresh in the middle of a save. */
window.addEventListener("focus", () => {
    if (!busy && !saving) refreshLectures();
});
})();
