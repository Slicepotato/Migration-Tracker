/**
 * Build Tracker — Admin JS (Dark Mode + Progress Bar)
 */
(function () {
    'use strict';

    let currentMigration = null;
    let changes          = [];
    let draggedCard      = null;
    let notesChangeId    = null;
    let devicesChangeId  = null;
    let attachChangeId   = null;
    let attachCurrentIds = [];

    function $(sel, ctx)  { return (ctx || document).querySelector(sel); }
    function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

    function ajax(action, data = {}) {
        const body = new FormData();
        body.append('action', action);
        body.append('nonce', MT.nonce);
        Object.entries(data).forEach(([k, v]) => body.append(k, v));
        return fetch(MT.ajax, { method: 'POST', body }).then(r => r.json()).then(r => { if (!r.success) throw new Error(r.data || 'Failed'); return r.data; });
    }

    function fmtDate(d) {
        return new Date(d.replace(' ', 'T')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'mt-toast'; el.textContent = msg;
        document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
    }

    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    /* =================================================================
       PROGRESS BAR
       ================================================================= */

    function updateProgress() {
        const total    = changes.length;
        const approved = changes.filter(c => c.status === 'approved' || c.status === 'testing').length;
        const pct      = total > 0 ? Math.round((approved / total) * 100) : 0;

        $('#mt-progress-text').textContent = `${approved} of ${total} approved`;
        $('#mt-progress-pct').textContent  = `${pct}%`;
        $('#mt-progress-bar').style.width  = `${pct}%`;

        // Color shifts based on progress
        const pctEl = $('#mt-progress-pct');
        if (pct === 100) {
            pctEl.style.color = 'var(--mt-green)';
        } else if (pct >= 50) {
            pctEl.style.color = 'var(--mt-amber)';
        } else {
            pctEl.style.color = 'var(--mt-pink-l)';
        }
    }

    /* =================================================================
       BUILD LIST
       ================================================================= */

    function loadMigrations() {
        ajax('mt_get_migrations').then(rows => {
            const list = $('#mt-migrations-list');
            const empty = $('#mt-empty');
            if (!rows.length) { list.innerHTML = ''; list.appendChild(empty); empty.style.display = ''; return; }
            empty.style.display = 'none';
            const html = rows.map(m => {
                const total = parseInt(m.pending_count) + parseInt(m.approved_count) + parseInt(m.testing_count);
                const approved = parseInt(m.approved_count) + parseInt(m.testing_count);
                const pct = total > 0 ? Math.round((approved / total) * 100) : 0;
                return `
                <div class="mt-migration-card" data-id="${m.id}">
                    <div class="mt-migration-card__info">
                        <span class="mt-migration-card__label">${escHtml(m.label)}</span>
                        <span class="mt-migration-card__date">${fmtDate(m.created_at)}</span>
                        <div class="mt-mini-progress"><div class="mt-mini-progress__fill" style="width:${pct}%"></div></div>
                    </div>
                    <div class="mt-migration-card__badges">
                        <span class="mt-badge mt-badge--pending">${m.pending_count} completed</span>
                        <span class="mt-badge mt-badge--approved">${m.approved_count} approved</span>
                        <span class="mt-badge mt-badge--testing">${m.testing_count} testing</span>
                        <button class="mt-btn mt-btn--danger mt-migration-card__delete" data-del="${m.id}" title="Delete build"><span class="dashicons dashicons-trash"></span></button>
                    </div>
                </div>`;
            }).join('');
            list.innerHTML = html;

            $$('.mt-migration-card', list).forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('[data-del]')) return;
                    openMigration(rows.find(r => r.id == card.dataset.id));
                });
            });

            $$('[data-del]', list).forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!confirm('Delete this build and all its changes?')) return;
                    ajax('mt_delete_migration', { id: btn.dataset.del }).then(() => { toast('Build deleted'); loadMigrations(); });
                });
            });
        });
    }

    /* =================================================================
       OPEN / CLOSE
       ================================================================= */

    function openMigration(m) {
        currentMigration = m;
        $('#mt-list-view').style.display = 'none';
        $('#mt-detail-view').style.display = '';
        $('#mt-detail-label').textContent = m.label;
        $('#mt-detail-date').textContent = fmtDate(m.created_at);
        loadChanges();
    }

    function closeMigration() {
        currentMigration = null;
        $('#mt-detail-view').style.display = 'none';
        $('#mt-list-view').style.display = '';
        loadMigrations();
    }

    /* =================================================================
       CHANGES
       ================================================================= */

    function loadChanges() {
        ajax('mt_get_changes', { migration_id: currentMigration.id }).then(rows => { changes = rows; renderChanges(); });
    }

    function renderChanges() {
        const pending  = changes.filter(c => c.status === 'pending');
        const approved = changes.filter(c => c.status === 'approved');
        const testing  = changes.filter(c => c.status === 'testing');

        $('#mt-pending-count').textContent  = pending.length;
        $('#mt-approved-count').textContent = approved.length;
        $('#mt-testing-count').textContent  = testing.length;

        $('#mt-pending-body').innerHTML  = pending.length ? pending.map(c => cardHtml(c)).join('') : '<p style="text-align:center;color:var(--mt-text3);font-size:12px;margin-top:40px;">No completed items yet.<br>Add one above.</p>';
        $('#mt-approved-body').innerHTML = approved.length ? approved.map(c => cardHtml(c)).join('') : '<p style="text-align:center;color:var(--mt-text3);font-size:12px;margin-top:40px;">Drag items here<br>to approve them.</p>';
        $('#mt-testing-body').innerHTML  = testing.length ? testing.map(c => cardHtml(c)).join('') : '<p style="text-align:center;color:var(--mt-text3);font-size:12px;margin-top:40px;">Drag approved items here<br>for post-launch testing.</p>';

        updateProgress();
        bindCardEvents();
        bindDragAndDrop();
    }

    function cardHtml(c) {
        const hasNotes = c.notes && c.notes.trim().length;
        const hasWarn  = parseInt(c.warning) === 1;
        const wC = hasWarn ? ' mt-change-card--warning' : '';
        const wB = hasWarn ? ' mt-action-warning--active' : '';

        let moveBtns = '';
        if (c.status === 'pending')  moveBtns = `<button class="mt-change-card__move-btn" data-move-id="${c.id}" data-move-to="approved">Approve →</button>`;
        if (c.status === 'approved') moveBtns = `<button class="mt-change-card__move-btn" data-move-id="${c.id}" data-move-to="pending">← Completed</button><button class="mt-change-card__move-btn" data-move-id="${c.id}" data-move-to="testing">Testing →</button>`;
        if (c.status === 'testing')  moveBtns = `<button class="mt-change-card__move-btn" data-move-id="${c.id}" data-move-to="approved">← Approved</button>`;

        const devices = (c.devices || '').trim();
        const dLines = devices ? devices.split('\n').filter(d => d.trim()) : [];
        let dHtml = '';
        if (c.status === 'testing' && dLines.length) dHtml = `<div class="mt-change-card__devices">${dLines.map(d => `<span class="mt-device-tag"><span class="dashicons dashicons-laptop"></span> ${escHtml(d.trim())}</span>`).join('')}</div>`;

        const devBtn = c.status === 'testing' ? `<button class="mt-action-devices" data-devices-id="${c.id}" title="Edit devices"><span class="dashicons dashicons-laptop"></span></button>` : '';

        const files = c.attachment_files || [];
        let aHtml = '';
        if (files.length) {
            const thumbs = files.filter(f => f.is_image).slice(0, 3);
            const imgC = files.filter(f => f.is_image).length;
            const nonC = files.filter(f => !f.is_image).length;
            aHtml = '<div class="mt-card-attachments">';
            if (thumbs.length) { aHtml += '<div class="mt-card-thumbs">'; thumbs.forEach(f => { aHtml += `<img src="${escHtml(f.thumb)}" alt="" class="mt-card-thumb" />`; }); if (imgC > 3) aHtml += `<span class="mt-card-thumb-more">+${imgC-3}</span>`; aHtml += '</div>'; }
            if (nonC > 0) aHtml += `<span class="mt-card-file-count"><span class="dashicons dashicons-media-default"></span> ${nonC} file${nonC>1?'s':''}</span>`;
            aHtml += '</div>';
        }

        return `
        <div class="mt-change-card${wC}" draggable="true" data-id="${c.id}" data-status="${c.status}">
            ${hasWarn ? '<div class="mt-warning-badge"><span class="dashicons dashicons-warning"></span> Warning – Test Data Analytics</div>' : ''}
            <div class="mt-change-card__title">${escHtml(c.title)}</div>
            ${c.description ? `<div class="mt-change-card__desc">${escHtml(c.description)}</div>` : ''}
            ${hasNotes ? `<div class="mt-change-card__notes-indicator"><span class="dashicons dashicons-edit"></span> Has notes</div>` : ''}
            ${dHtml}${aHtml}
            <div class="mt-change-card__footer">
                <span class="mt-change-card__date">${fmtDate(c.created_at)}</span>
                <div class="mt-change-card__actions">
                    <button class="mt-action-attach" data-attach-id="${c.id}" title="Attachments"><span class="dashicons dashicons-paperclip"></span>${files.length?`<span class="mt-attach-badge">${files.length}</span>`:''}</button>
                    ${devBtn}
                    <button class="mt-action-warning${wB}" data-warn-id="${c.id}" title="Toggle warning"><span class="dashicons dashicons-warning"></span></button>
                    <button class="mt-action-notes" data-notes-id="${c.id}" title="Notes"><span class="dashicons dashicons-edit"></span></button>
                    <button class="mt-action-delete" data-delete-id="${c.id}" title="Delete"><span class="dashicons dashicons-trash"></span></button>
                </div>
            </div>
            <div class="mt-change-card__move-btns">${moveBtns}</div>
        </div>`;
    }

    /* =================================================================
       CARD EVENTS
       ================================================================= */

    function bindCardEvents() {
        $$('[data-notes-id]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); notesChangeId = btn.dataset.notesId; const ch = changes.find(c => c.id == notesChangeId); $('#mt-notes-textarea').value = ch ? (ch.notes||'') : ''; $('#mt-notes-overlay').style.display = ''; }));
        $$('[data-delete-id]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); ajax('mt_delete_change', { id: btn.dataset.deleteId }).then(() => { toast('Item removed'); loadChanges(); }); }));

        $$('[data-move-id]').forEach(btn => btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.moveId, status = btn.dataset.moveTo;
            ajax('mt_update_change_status', { id, status }).then(() => {
                toast({ approved:'Item approved!', testing:'Moved to testing', pending:'Moved to completed' }[status] || 'Updated');
                if (status === 'testing') { loadChanges(); devicesChangeId = id; const ch = changes.find(c => c.id == id); $('#mt-devices-textarea').value = ch?(ch.devices||''):''; $('#mt-devices-overlay').style.display = ''; }
                else loadChanges();
            });
        }));

        $$('[data-warn-id]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); ajax('mt_toggle_warning', { id: btn.dataset.warnId }).then(res => { const ch = changes.find(c => c.id == btn.dataset.warnId); if (ch) ch.warning = res.warning; toast(res.warning ? 'Warning added' : 'Warning removed'); renderChanges(); }); }));
        $$('[data-devices-id]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); devicesChangeId = btn.dataset.devicesId; const ch = changes.find(c => c.id == devicesChangeId); $('#mt-devices-textarea').value = ch?(ch.devices||''):''; $('#mt-devices-overlay').style.display = ''; }));
        $$('[data-attach-id]').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); openAttachModal(btn.dataset.attachId); }));
    }

    /* =================================================================
       ATTACHMENTS
       ================================================================= */

    function openAttachModal(changeId) {
        attachChangeId = changeId;
        const ch = changes.find(c => c.id == changeId);
        const files = ch ? (ch.attachment_files || []) : [];
        attachCurrentIds = files.map(f => f.id);
        renderAttachList(files);
        $('#mt-attach-overlay').style.display = '';
    }

    function renderAttachList(files) {
        const list = $('#mt-attach-list');
        if (!files.length) { list.innerHTML = '<p class="mt-attach-empty">No files attached yet. Click "Add Files" to upload.</p>'; return; }
        list.innerHTML = files.map(f => `
            <div class="mt-attach-item" data-att-id="${f.id}">
                ${f.is_image ? `<img src="${escHtml(f.thumb||f.url)}" alt="" class="mt-attach-thumb"/>` : `<span class="mt-attach-file-icon dashicons dashicons-media-default"></span>`}
                <div class="mt-attach-info">
                    <a href="${escHtml(f.url)}" target="_blank" class="mt-attach-name" download>${escHtml(f.filename)}</a>
                    <a href="${escHtml(f.url)}" target="_blank" class="mt-attach-download" download><span class="dashicons dashicons-download"></span> Download</a>
                </div>
                <button class="mt-attach-remove" data-remove-att="${f.id}" title="Remove"><span class="dashicons dashicons-no-alt"></span></button>
            </div>`).join('');
        $$('[data-remove-att]', list).forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); attachCurrentIds = attachCurrentIds.filter(id => id !== parseInt(btn.dataset.removeAtt)); saveAttachments(); }));
    }

    function saveAttachments() {
        if (!attachChangeId) return;
        ajax('mt_update_attachments', { id: attachChangeId, attachment_ids: JSON.stringify(attachCurrentIds) }).then(res => {
            const ch = changes.find(c => c.id == attachChangeId);
            if (ch) { ch.attachment_files = res.attachment_files; ch.attachments = JSON.stringify(attachCurrentIds); }
            renderAttachList(res.attachment_files); renderChanges();
        });
    }

    /* =================================================================
       DRAG & DROP
       ================================================================= */

    function bindDragAndDrop() {
        const cards = $$('.mt-change-card'), cols = $$('.mt-col__body');
        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => { draggedCard = card; card.classList.add('mt-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
            card.addEventListener('dragend', () => { card.classList.remove('mt-dragging'); draggedCard = null; cols.forEach(c => c.classList.remove('mt-dragover')); });
        });
        cols.forEach(col => {
            col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('mt-dragover'); });
            col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('mt-dragover'); });
            col.addEventListener('drop', (e) => {
                e.preventDefault(); col.classList.remove('mt-dragover');
                if (!draggedCard) return;
                const id = draggedCard.dataset.id, newS = col.dataset.status;
                if (newS === draggedCard.dataset.status) return;
                ajax('mt_update_change_status', { id, status: newS }).then(() => {
                    toast({ approved:'Item approved!', testing:'Moved to testing', pending:'Moved to completed' }[newS] || 'Updated');
                    loadChanges();
                    if (newS === 'testing') { devicesChangeId = id; const ch = changes.find(c => c.id == id); $('#mt-devices-textarea').value = ch?(ch.devices||''):''; setTimeout(() => $('#mt-devices-overlay').style.display = '', 250); }
                });
            });
        });
    }

    /* =================================================================
       INIT
       ================================================================= */

    document.addEventListener('DOMContentLoaded', () => {
        loadMigrations();

        $('#mt-new-migration-btn').addEventListener('click', () => { $('#mt-migration-label').value = ''; $('#mt-modal-overlay').style.display = ''; setTimeout(() => $('#mt-migration-label').focus(), 50); });
        $('#mt-modal-cancel').addEventListener('click', () => $('#mt-modal-overlay').style.display = 'none');
        $('#mt-modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#mt-modal-overlay').style.display = 'none'; });
        $('#mt-modal-create').addEventListener('click', () => { const l = $('#mt-migration-label').value.trim(); if (!l) return; ajax('mt_create_migration', { label: l }).then(m => { $('#mt-modal-overlay').style.display = 'none'; toast('Build created!'); openMigration(m); }); });
        $('#mt-migration-label').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mt-modal-create').click(); });
        $('#mt-back-btn').addEventListener('click', closeMigration);

        $('#mt-add-change-btn').addEventListener('click', () => {
            const title = $('#mt-change-title').value.trim(); if (!title || !currentMigration) return;
            ajax('mt_add_change', { migration_id: currentMigration.id, title, description: $('#mt-change-desc').value.trim(), warning: $('#mt-change-warning').checked ? 1 : 0 }).then(() => {
                $('#mt-change-title').value = ''; $('#mt-change-desc').value = ''; $('#mt-change-warning').checked = false; toast('Item added'); loadChanges();
            });
        });
        $('#mt-change-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#mt-add-change-btn').click(); } });

        // Notes
        $('#mt-notes-cancel').addEventListener('click', () => { $('#mt-notes-overlay').style.display = 'none'; notesChangeId = null; });
        $('#mt-notes-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) { $('#mt-notes-overlay').style.display = 'none'; notesChangeId = null; } });
        $('#mt-notes-save').addEventListener('click', () => { if (!notesChangeId) return; const n = $('#mt-notes-textarea').value; ajax('mt_update_change_notes', { id: notesChangeId, notes: n }).then(() => { const ch = changes.find(c => c.id == notesChangeId); if (ch) ch.notes = n; $('#mt-notes-overlay').style.display = 'none'; notesChangeId = null; toast('Notes saved'); renderChanges(); }); });

        // Devices
        $('#mt-devices-cancel').addEventListener('click', () => { $('#mt-devices-overlay').style.display = 'none'; devicesChangeId = null; });
        $('#mt-devices-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) { $('#mt-devices-overlay').style.display = 'none'; devicesChangeId = null; } });
        $('#mt-devices-save').addEventListener('click', () => { if (!devicesChangeId) return; const d = $('#mt-devices-textarea').value; ajax('mt_update_change_devices', { id: devicesChangeId, devices: d }).then(() => { const ch = changes.find(c => c.id == devicesChangeId); if (ch) ch.devices = d; $('#mt-devices-overlay').style.display = 'none'; devicesChangeId = null; toast('Devices saved'); renderChanges(); }); });

        // Attachments
        $('#mt-attach-close').addEventListener('click', () => { $('#mt-attach-overlay').style.display = 'none'; attachChangeId = null; attachCurrentIds = []; });
        $('#mt-attach-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) { $('#mt-attach-overlay').style.display = 'none'; attachChangeId = null; attachCurrentIds = []; } });
        $('#mt-attach-add').addEventListener('click', () => {
            const frame = wp.media({ title: 'Select Files', button: { text: 'Attach Selected' }, multiple: true });
            frame.on('select', () => { frame.state().get('selection').toJSON().forEach(att => { if (!attachCurrentIds.includes(att.id)) attachCurrentIds.push(att.id); }); saveAttachments(); });
            frame.open();
        });

        /* =================================================================
        SETTINGS MODAL
        ================================================================= */

        const settingsBtn = $('#mt-settings-btn');
        const settingsOverlay = $('#mt-settings-overlay');
        const deleteDataCheckbox = $('#mt-delete-data');

        if (settingsBtn && settingsOverlay && deleteDataCheckbox) {

            // Open modal
            settingsBtn.addEventListener('click', () => settingsOverlay.style.display = 'flex');

            // Close modal
            $('#mt-settings-close').addEventListener('click', () => settingsOverlay.style.display = 'none');

            // Load current setting
            ajax('mt_get_settings').then(res => {
                if (res && res.delete_data_on_uninstall) {
                    deleteDataCheckbox.checked = true;
                }
            }).catch(() => { /* fail silently */ });

            // Save setting on toggle
            deleteDataCheckbox.addEventListener('change', () => {
                const checked = deleteDataCheckbox.checked ? 1 : 0;
                ajax('mt_save_settings', { delete_data: checked }).catch(() => { /* fail silently */ });
            });
        }
    });
})();
