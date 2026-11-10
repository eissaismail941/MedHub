(() => {
    "use strict";

    const SUPABASE_URL =
        "https://lxmxsymxmpulkkngjfjo.supabase.co";

    const PUBLIC_KEY =
        "sb_publishable_-7LnL-kzS1omjDFD5va_0A_Tjdh3m8h";

    const ADMIN_ID =
        "475f2fec-d7da-4443-91dc-d75e03dfacbd";

    const $ = id => document.getElementById(id);

    let session = null;
    let busy = false;
    let loading = false;
    let pending = null;

    /* Create the hidden admin window. */
    const dialog = document.createElement("dialog");
    dialog.id = "mh-admin";
    dialog.setAttribute("aria-labelledby", "mh-heading");

    dialog.innerHTML = `
        <div class="mh-row">
            <h2 id="mh-heading">MedHub Admin</h2>
            <button id="mh-close" type="button"
                class="mh-secondary" aria-label="Close">✕</button>
        </div>

        <form id="mh-login">
            <p>Sign in to upload a lecture.</p>

            <label for="mh-email">Email</label>
            <input id="mh-email" type="email"
                autocomplete="username" required>

            <label for="mh-password">Password</label>
            <input id="mh-password" type="password"
                autocomplete="current-password" required>

            <button id="mh-signin"
                style="margin-top:20px">Sign in</button>
        </form>

        <div id="mh-panel" hidden>
            <div class="mh-row">
                <p>Publish a PDF to its subject library.</p>
                <button id="mh-signout" type="button"
                    class="mh-secondary">Sign out</button>
            </div>

            <form id="mh-upload">
                <div class="mh-columns">
                    <div>
                        <label for="mh-stage">Stage</label>
                        <select id="mh-stage">
                            <option value="1">Stage 1</option>
                            <option value="2" selected>Stage 2</option>
                        </select>
                    </div>

                    <div>
                        <label for="mh-block">Block</label>
                        <select id="mh-block"></select>
                    </div>
                </div>

                <label for="mh-subject">Subject / section</label>
                <select id="mh-subject" required></select>

                <p id="mh-empty" hidden>
                    This block has no subject cards yet.
                    Add its subjects to the website first.
                </p>

                <label for="mh-title">Lecture title</label>
                <input id="mh-title" maxlength="200" required>

                <div class="mh-columns">
                    <div>
                        <label for="mh-category">Type</label>
                        <select id="mh-category">
                            <option>Lecture</option>
                            <option>SGL</option>
                            <option>LG</option>
                            <option>Lab</option>
                            <option>Practical</option>
                            <option>Theory</option>
                        </select>
                    </div>

                    <div>
                        <label for="mh-order">Order among new lectures</label>
                        <input id="mh-order" type="number"
                            min="0" max="100000" value="0" required>
                    </div>
                </div>

                <label for="mh-description">
                    Label — optional, e.g. Lab 8
                </label>
                <input id="mh-description" maxlength="200">

                <label for="mh-file">PDF — maximum 50 MB</label>
                <input id="mh-file" type="file"
                    accept=".pdf,application/pdf" required>

                <button id="mh-publish" style="margin-top:20px">
                    Publish lecture
                </button>
            </form>
        </div>

        <div id="mh-status" role="status" aria-live="polite"></div>
    `;

    document.body.append(dialog);

    /* Prevent the existing mobile focus fixes
       from closing the keyboard inside this form. */
    dialog.addEventListener("touchend", event => {
        event.stopPropagation();
    });

    const notice = document.createElement("div");
    notice.id = "mh-cloud-status";
    notice.setAttribute("role", "status");
    document.body.append(notice);

    function status(message, error = false) {
        $("mh-status").textContent = message;
        $("mh-status").style.color =
            error ? "#b91c1c" : "#166534";
    }

    /* Remember all existing GitHub lectures. */
    const original = Object.fromEntries(
        Object.entries(subjectMap).map(([key, subject]) => [
            key,
            subject.resources.slice()
        ])
    );

    /* Build the upload menus from your existing cards. */
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
                key: module.key,
                name: module.name
            });
        }
    }

    function setOptions(select, items) {
        select.replaceChildren(
            ...items.map(([value, label]) => new Option(label, value))
        );
    }

    function updateSubjects() {
        const matches = catalog.filter(subject =>
            subject.stage === Number($("mh-stage").value) &&
            subject.block === Number($("mh-block").value)
        );

        setOptions(
            $("mh-subject"),
            matches.map(subject => [subject.key, subject.name])
        );

        $("mh-empty").hidden = matches.length > 0;
        $("mh-publish").disabled = busy || matches.length === 0;
    }

    function updateBlocks() {
        const blocks = $("mh-stage").value === "1"
            ? [[1, "Block 1"], [2, "Block 2"]]
            : stage2Blocks.map(block => [
                block.n,
                block.code + " · " + block.name
            ]);

        setOptions($("mh-block"), blocks);
        updateSubjects();
    }

    $("mh-stage").onchange = updateBlocks;
    $("mh-block").onchange = updateSubjects;
    updateBlocks();

    /* Only #admin opens the login. No homepage button. */
    function openAdmin() {
        if (location.hash !== "#admin") return;

        if (!dialog.open) dialog.showModal();

        (session ? $("mh-title") : $("mh-email")).focus();
    }

    window.addEventListener("hashchange", openAdmin);
    openAdmin();

    $("mh-close").onclick = () => {
        if (busy) return;

        dialog.close();

        if (location.hash === "#admin") {
            history.replaceState(
                history.state,
                "",
                location.pathname + location.search
            );
        }
    };

    dialog.addEventListener("cancel", event => {
        if (busy) event.preventDefault();
    });

    /* Send requests to Supabase. */
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

    function updateLogin() {
        $("mh-login").hidden = Boolean(session);
        $("mh-panel").hidden = !session;
    }

    $("mh-login").onsubmit = async event => {
        event.preventDefault();
        $("mh-signin").disabled = true;
        status("Signing in…");

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
                throw new Error(
                    "This account does not have admin access."
                );
            }

            session = {
                ...data,
                expires: Date.now() + data.expires_in * 1000
            };

            updateLogin();
            status("Signed in. Choose a subject and upload your PDF.");
        } catch (error) {
            status(error.message, true);
        } finally {
            $("mh-signin").disabled = false;
        }
    };

    async function accessToken() {
        if (!session) throw new Error("Please sign in again.");

        if (Date.now() > session.expires - 60000) {
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
                expires: Date.now() + data.expires_in * 1000
            };
        }

        return session.access_token;
    }

    $("mh-signout").onclick = async () => {
        const token = session?.access_token;
        session = null;
        updateLogin();
        status("Signed out.");

        if (token) {
            request("/auth/v1/logout", {
                method: "POST",
                token
            }).catch(() => {});
        }
    };

    function pdfURL(path) {
        return SUPABASE_URL +
            "/storage/v1/object/public/lectures/" +
            path.split("/").map(encodeURIComponent).join("/");
    }

    /* Render resource text safely, including uploaded titles. */
    renderResources = function (items, group, subjectTitle) {
        const grid = $("resource-grid");
        grid.replaceChildren();

        items.forEach((item, index) => {
            const card = document.createElement("article");
            card.className = "resource-card" +
                (group === "bbb" ? " bbb-resource" : "");

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

    /* Upload PDF, then save its lecture details. */
    $("mh-upload").onsubmit = async event => {
        event.preventDefault();
        if (busy) return;

        const file = $("mh-file").files[0];

        const destination = catalog.find(subject =>
            subject.key === $("mh-subject").value &&
            subject.stage === Number($("mh-stage").value) &&
            subject.block === Number($("mh-block").value)
        );

        if (!file || !destination) {
            return status("Choose a subject and a PDF.", true);
        }

        if (!file.size || file.size > 50 * 1024 * 1024) {
            return status("Choose a PDF no larger than 50 MB.", true);
        }

        if (!$("mh-title").value.trim()) {
            return status("Enter the lecture title.", true);
        }

        busy = true;

        const controls = [
            ...$("mh-upload").elements,
            $("mh-signout")
        ];

        controls.forEach(control => control.disabled = true);

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
                status("Uploading PDF… Keep this page open.");

                await request(
                    "/storage/v1/object/lectures/" + pending.path,
                    {
                        method: "POST",
                        token,
                        body: file,
                        headers: {
                            "Content-Type": "application/pdf",
                            "x-upsert": "false"
                        }
                    }
                );

                pending.uploaded = true;
            }

            status("Saving lecture details…");

            await request("/rest/v1/lectures?on_conflict=id", {
                method: "POST",
                token,
                headers: {
                    "Content-Type": "application/json",
                    Prefer: "resolution=ignore-duplicates,return=minimal"
                },
                body: JSON.stringify({
                    id: pending.id,
                    title: $("mh-title").value.trim(),
                    stage: destination.stage,
                    block: destination.block,
                    subject: destination.key,
                    category: $("mh-category").value,
                    description: $("mh-description").value.trim(),
                    sort_order: Number($("mh-order").value),
                    file_path: pending.path
                })
            });

            pending = null;
            $("mh-upload").reset();
            updateBlocks();

            const refreshed = await refreshLectures();

            status(
                refreshed
                    ? "Published! Your lecture is in its subject library."
                    : "Published! Refresh the website to see the lecture."
            );
        } catch (error) {
            status(
                error.message +
                (pending?.uploaded
                    ? " Your PDF is uploaded. Press Publish again to retry saving its details."
                    : ""),
                true
            );
        } finally {
            busy = false;
            controls.forEach(control => control.disabled = false);
            updateSubjects();
        }
    };

    refreshLectures();
    window.addEventListener("focus", refreshLectures);
})();
