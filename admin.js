(() => {
    "use strict";

    const SUPABASE_URL =
        "https://lxmxsymxmpulkkngjfjo.supabase.co";

    const PUBLIC_KEY =
        "sb_publishable_-7LnL-kzS1omjDFD5va_0A_Tjdh3m8h";

    const ADMIN_ID =
        "475f2fec-d7da-4443-91dc-d75e03dfacbd";

    const MAX_BYTES = 50 * 1024 * 1024;
    const $ = id => document.getElementById(id);
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

    let session = null;     // kept in memory only
    let busy = false;
    let loading = false;
    let pending = null;     // an upload that can be retried safely
    let lastRows = [];
    let fab = null;
    let sheetKey = null;    // subject the form currently holds a draft for
    let titleTouched = false;

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
        check: icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 24, 2.4)
    };

    const TYPES = ["Lecture", "SGL", "LG", "Lab", "Practical", "Theory"];

    /* ---------- Sign-in window ---------- */
    const loginDialog = document.createElement("dialog");
    loginDialog.className = "mh-dialog mh-login-dialog";
    loginDialog.setAttribute("aria-labelledby", "mh-login-title");
    loginDialog.innerHTML = `
        <button id="mh-login-close" class="mh-icon-btn mh-close"
            type="button" aria-label="Close">${ICON.close}</button>
        <div class="mh-badge">${ICON.lock}</div>
        <h2 id="mh-login-title">Admin sign in</h2>

        <form id="mh-login">
            <p class="mh-lead" style="margin:-8px 0 2px">
                Sign in to add lectures to MedHub.
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
                Open a subject's lecture page and tap the + button to add a lecture.
            </p>
            <div class="mh-actions">
                <button id="mh-signout" type="button"
                    class="mh-btn mh-btn-ghost">Sign out</button>
                <button id="mh-account-done" type="button"
                    class="mh-btn mh-btn-primary">Done</button>
            </div>
        </div>
    `;

    /* ---------- Upload sheet ---------- */
    const sheet = document.createElement("dialog");
    sheet.className = "mh-dialog mh-sheet";
    sheet.setAttribute("aria-labelledby", "mh-sheet-title");
    sheet.innerHTML = `
        <form id="mh-upload" class="mh-sheet-form" novalidate>
            <div class="mh-sheet-head">
                <div class="mh-grab" aria-hidden="true"></div>
                <div class="mh-head-row">
                    <div>
                        <h2 id="mh-sheet-title">Add a lecture</h2>
                        <p id="mh-dest" class="mh-dest"
                            aria-label="Publishing to"></p>
                    </div>
                    <button id="mh-sheet-close" class="mh-icon-btn"
                        type="button" aria-label="Close">${ICON.close}</button>
                </div>
            </div>

            <div class="mh-sheet-body">
                <div class="mh-field">
                    <label for="mh-title">Lecture title</label>
                    <input id="mh-title" type="text" maxlength="200"
                        autocomplete="off" enterkeyhint="next"
                        placeholder="e.g. Brachial plexus" required>
                </div>

                <fieldset class="mh-field">
                    <legend>Type</legend>
                    <div class="mh-types">
                        ${TYPES.map((type, index) => `
                            <label class="mh-chip">
                                <input type="radio" name="category"
                                    value="${type}"${index === 0 ? " checked" : ""}>
                                <span>${type}</span>
                            </label>`).join("")}
                    </div>
                </fieldset>

                <div class="mh-field">
                    <label for="mh-description">
                        Label<span class="mh-opt">Optional</span>
                    </label>
                    <input id="mh-description" type="text" maxlength="200"
                        autocomplete="off" placeholder="e.g. Lab 8">
                </div>

                <div class="mh-field">
                    <label for="mh-file">PDF file</label>
                    <label id="mh-drop" class="mh-drop" for="mh-file">
                        <span id="mh-drop-icon" class="mh-drop-icon">${ICON.pdf}</span>
                        <strong id="mh-drop-title">Choose a PDF</strong>
                        <small id="mh-drop-sub">Tap to browse. Up to 50 MB.</small>
                        <input id="mh-file" type="file"
                            accept=".pdf,application/pdf">
                    </label>
                </div>

                <div id="mh-progress" class="mh-progress" hidden>
                    <span id="mh-progress-text">Uploading…</span>
                    <div class="mh-bar"><span id="mh-bar-fill"></span></div>
                </div>

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
    `;

    const toastEl = document.createElement("div");
    toastEl.className = "mh-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");

    const notice = document.createElement("div");
    notice.id = "mh-cloud-status";
    notice.setAttribute("role", "status");

    document.body.append(loginDialog, sheet, toastEl, notice);

    /* Stop the site's iOS focus fix from closing the keyboard here. */
    for (const dialog of [loginDialog, sheet]) {
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
            if (!loginDialog.open && !sheet.open) {
                document.documentElement.classList.remove("mh-lock");
            }

            if (dialog === loginDialog) cleanHash();
        });
    }

    function lockPage() {
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

    let toastTimer;

    function toast(message, kind = "info") {
        toastEl.textContent = message;
        toastEl.dataset.kind = kind;
        toastEl.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(
            () => toastEl.classList.remove("show"),
            4500
        );
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

    /* ---------- Show or hide the admin controls ---------- */
    function syncAdmin() {
        if (!session) {
            fab?.remove();
            fab = null;
            document.body.classList.remove("mh-has-fab");
            return;
        }

        const subject = currentSubject();

        if (!fab) {
            fab = document.createElement("button");
            fab.type = "button";
            fab.className = "mh-fab";
            fab.title = "Add a lecture";
            fab.setAttribute("aria-label", "Add a lecture");
            fab.setAttribute("aria-haspopup", "dialog");
            fab.innerHTML = ICON.plus;
            fab.hidden = true;
            fab.onclick = openSheet;
            document.body.append(fab);
        }

        fab.hidden = !subject;
        document.body.classList.toggle("mh-has-fab", Boolean(subject));

        if (sheet.open && !busy && (!subject || subject.key !== sheetKey)) {
            sheet.close();
        }
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

    /* Upload with a progress bar and a timeout suited to large PDFs. */
    function uploadPDF(path, file, token, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.open(
                "POST",
                SUPABASE_URL + "/storage/v1/object/lectures/" + path
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

                reject(new Error(detail || "Upload failed: " + xhr.status));
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
            try {
                const data = await request(
                    "/auth/v1/token?grant_type=refresh_token",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            refresh_token: session.refresh_token
                        })
                    }
                );

                session = {
                    ...data,
                    user: data.user || session.user,
                    expires: Date.now() + data.expires_in * 1000
                };
            } catch {
                session = null;
                syncAdmin();

                throw new Error(
                    "Your session ended. Open #admin to sign in again."
                );
            }
        }

        return session.access_token;
    }

    /* ---------- Sign in and out ---------- */
    function openAdmin() {
        if (location.hash !== "#admin") return;

        if (sheet.open) return;

        $("mh-login").hidden = Boolean(session);
        $("mh-account").hidden = !session;

        if (session) {
            const email = session.user?.email || "Admin";
            $("mh-account-email").textContent = email;
            $("mh-avatar").textContent = email.charAt(0).toUpperCase();
        }

        message($("mh-login-error"), "");

        if (!loginDialog.open) {
            loginDialog.showModal();
            lockPage();
        }

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

            if (data.user?.id !== ADMIN_ID) {
                request("/auth/v1/logout", {
                    method: "POST",
                    token: data.access_token
                }).catch(() => {});

                throw new Error(
                    "This account does not have admin access."
                );
            }

            session = {
                ...data,
                expires: Date.now() + data.expires_in * 1000
            };

            loginDialog.close();
            syncAdmin();

            toast(
                currentSubject()
                    ? "Signed in. Tap + to add a lecture."
                    : "Signed in. Open a subject to add a lecture.",
                "success"
            );
        } catch (error) {
            message($("mh-login-error"), error.message);
        } finally {
            setBusyButton($("mh-signin"), false, "Sign in");
            $("mh-signin").disabled = false;
        }
    };

    $("mh-signout").onclick = () => {
        const token = session?.access_token;

        session = null;
        pending = null;
        sheetKey = null;

        if (sheet.open) sheet.close();

        loginDialog.close();
        syncAdmin();
        toast("Signed out.");

        if (token) {
            request("/auth/v1/logout", {
                method: "POST",
                token
            }).catch(() => {});
        }
    };

    /* ---------- Upload sheet ---------- */
    function renderDestination(subject) {
        const dest = $("mh-dest");

        dest.replaceChildren();
        dest.insertAdjacentHTML("beforeend", ICON.folder);

        for (const text of [
            "Stage " + subject.stage,
            subject.blockLabel,
            subject.name
        ]) {
            const part = document.createElement("span");
            part.textContent = text;
            dest.append(part);
        }
    }

    function updateFileBox() {
        const file = $("mh-file").files[0];

        $("mh-drop").classList.toggle("has-file", Boolean(file));
        $("mh-drop-icon").innerHTML = file ? ICON.check : ICON.pdf;
        $("mh-drop-title").textContent = file ? file.name : "Choose a PDF";
        $("mh-drop-sub").textContent = file
            ? formatSize(file.size) + ". Tap to replace."
            : "Tap to browse. Up to 50 MB.";
    }

    function resetForm() {
        $("mh-upload").reset();
        pending = null;
        titleTouched = false;
        updateFileBox();
        message($("mh-status"), "");
        $("mh-progress").hidden = true;
        $("mh-bar-fill").style.width = "0";
    }

    function openSheet() {
        const subject = currentSubject();

        if (!session || !subject) return;

        if (sheetKey !== subject.key) {
            resetForm();
            sheetKey = subject.key;
        }

        renderDestination(subject);
        message($("mh-status"), "");

        sheet.showModal();
        lockPage();

        if (matchMedia("(pointer: fine)").matches) $("mh-title").focus();
    }

    $("mh-sheet-close").onclick = () => sheet.close();
    $("mh-cancel").onclick = () => sheet.close();

    $("mh-title").addEventListener("input", () => {
        titleTouched = true;
    });

    function pickFile(file) {
        const looksLikePDF =
            file.type === "application/pdf" || /\.pdf$/i.test(file.name);

        if (!looksLikePDF) {
            $("mh-file").value = "";
            updateFileBox();
            return message($("mh-status"), "Choose a PDF file.");
        }

        message($("mh-status"), "");
        updateFileBox();

        if (!$("mh-title").value.trim() && !titleTouched) {
            $("mh-title").value = file.name
                .replace(/\.pdf$/i, "")
                .replace(/[_-]+/g, " ")
                .trim()
                .slice(0, 200);
        }
    }

    $("mh-file").addEventListener("change", () => {
        const file = $("mh-file").files[0];

        if (file) pickFile(file);
        else updateFileBox();
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

        const file = event.dataTransfer?.files[0];

        if (!file) return;

        const transfer = new DataTransfer();
        transfer.items.add(file);
        $("mh-file").files = transfer.files;
        pickFile(file);
    });

    /* New lectures go after the existing ones in this subject. */
    function nextOrder(subject) {
        let highest = -1;

        for (const row of lastRows) {
            if (
                row.subject === subject.key &&
                row.stage === subject.stage &&
                row.block === subject.block
            ) {
                const order = Number(row.sort_order);

                if (Number.isFinite(order)) highest = Math.max(highest, order);
            }
        }

        return Math.min(highest + 1, 100000);
    }

    function pdfURL(path) {
        return SUPABASE_URL +
            "/storage/v1/object/public/lectures/" +
            path.split("/").map(encodeURIComponent).join("/");
    }

    /* Upload PDF, then save its lecture details. */
    $("mh-upload").onsubmit = async event => {
        event.preventDefault();
        if (busy) return;

        const subject = currentSubject();
        const file = $("mh-file").files[0];
        const title = $("mh-title").value.trim();

        if (!session || !subject || subject.key !== sheetKey) {
            return message(
                $("mh-status"),
                "Open the subject's lecture page and try again."
            );
        }

        if (!title) {
            $("mh-title").focus();
            return message($("mh-status"), "Enter the lecture title.");
        }

        if (!file) {
            return message($("mh-status"), "Choose a PDF to upload.");
        }

        if (!file.size || file.size > MAX_BYTES) {
            return message(
                $("mh-status"),
                "Choose a PDF no larger than 50 MB."
            );
        }

        busy = true;

        const controls = [...$("mh-upload").elements];
        controls.forEach(control => control.disabled = true);
        setBusyButton($("mh-publish"), true, "Publishing…");
        message($("mh-status"), "");

        let publishedUrl = null;

        try {
            const header = new TextDecoder().decode(
                await file.slice(0, 1024).arrayBuffer()
            );

            if (!header.includes("%PDF-")) {
                throw new Error("This file does not appear to be a PDF.");
            }

            const token = await accessToken();

            if (!pending || pending.file !== file) {
                pending = {
                    file,
                    id: crypto.randomUUID(),
                    path: ADMIN_ID + "/" + crypto.randomUUID() + ".pdf",
                    uploaded: false
                };
            }

            if (!pending.uploaded) {
                $("mh-progress").hidden = false;
                $("mh-progress-text").textContent = "Uploading PDF… 0%";
                $("mh-bar-fill").style.width = "0";

                await uploadPDF(pending.path, file, token, fraction => {
                    const percent = Math.round(fraction * 100);
                    $("mh-bar-fill").style.width = percent + "%";
                    $("mh-progress-text").textContent =
                        "Uploading PDF… " + percent + "%";
                });

                pending.uploaded = true;
            }

            $("mh-bar-fill").style.width = "100%";
            $("mh-progress-text").textContent = "Saving lecture details…";

            await request("/rest/v1/lectures?on_conflict=id", {
                method: "POST",
                token: await accessToken(),
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "resolution=ignore-duplicates,return=minimal"
                },
                body: JSON.stringify({
                    id: pending.id,
                    title,
                    stage: subject.stage,
                    block: subject.block,
                    subject: subject.key,
                    category: $("mh-upload")
                        .querySelector('input[name="category"]:checked').value,
                    description: $("mh-description").value.trim(),
                    sort_order: nextOrder(subject),
                    file_path: pending.path
                })
            });

            publishedUrl = pdfURL(pending.path);
            resetForm();
            sheetKey = null;
        } catch (error) {
            message(
                $("mh-status"),
                error.message +
                (pending?.uploaded
                    ? " Your PDF is uploaded. Press Publish lecture to retry saving its details."
                    : "")
            );

            $("mh-progress").hidden = true;
        } finally {
            busy = false;
            controls.forEach(control => control.disabled = false);
            setBusyButton($("mh-publish"), false, "Publish lecture");
        }

        if (!publishedUrl) return;

        sheet.close();

        while (loading) {
            await new Promise(resolve => setTimeout(resolve, 120));
        }

        const refreshed = await refreshLectures();

        if (refreshed) {
            toast("Published. " + title + " is now in " + subject.name + ".", "success");
            highlight(publishedUrl);
        } else {
            toast("Published. Refresh the page to see the new lecture.", "success");
        }
    };

    function highlight(url) {
        requestAnimationFrame(() => {
            const card = [...$("resource-grid").children]
                .find(item => item.dataset.url === url);

            if (!card) return;

            card.scrollIntoView({
                behavior: reduceMotion.matches ? "auto" : "smooth",
                block: "center"
            });

            card.classList.add("mh-new");
            setTimeout(() => card.classList.remove("mh-new"), 4000);
        });
    }

    /* ---------- Lecture cards (rendered safely) ---------- */
    renderResources = function (items, group, subjectTitle) {
        const grid = $("resource-grid");
        grid.replaceChildren();

        items.forEach((item, index) => {
            const card = document.createElement("article");
            card.className = "resource-card" +
                (group === "bbb" ? " bbb-resource" : "");

            card.dataset.url = item.url;

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
            add(
                "div",
                "resource-index",
                "PDF " + String(index + 1).padStart(2, "0")
            );
            add("h3", "", item.title);
            add("p", "", item.description);

            const actions = add("div", "resource-actions", "");

            const open = document.createElement("a");
            open.className = "btn-link btn-open";
            open.textContent = isIOS ? "Open / Save PDF" : "Open PDF";
            open.href = item.url;
            open.target = item.url === "./pathology-labs2&3.pdf"
                ? "_self"
                : "_blank";
            open.rel = "noopener noreferrer";

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
            grid.append(card);
        });
    };

    /* Fetch new lectures without changing existing ones. */
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

            for (const [key, resources] of Object.entries(original)) {
                subjectMap[key].resources = resources.slice();
            }

            for (const row of rows) {
                const subject = catalog.find(subject =>
                    subject.key === row.subject &&
                    subject.stage === row.stage &&
                    subject.block === row.block
                );

                if (
                    !subject ||
                    typeof row.file_path !== "string" ||
                    row.file_path.includes("..")
                ) continue;

                const url = pdfURL(row.file_path);

                subjectMap[subject.key].resources.push({
                    title: row.title,
                    description: row.description || row.category,
                    url,
                    downloadUrl: url + "?download=" +
                        encodeURIComponent(row.title + ".pdf")
                });
            }

            if (history.state?.v === "res") {
                renderResourcePage(history.state.key);
            }

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

    refreshLectures();
    window.addEventListener("focus", refreshLectures);
})();
