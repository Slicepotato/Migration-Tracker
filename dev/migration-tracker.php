<?php
/**
 * Plugin Name: Build Tracker
 * Description: Track and approve changes across website builds with drag-and-drop workflow and file attachments.
 * Version: 3.0.0
 * Author: Blink Digital Agency
 * Text Domain: migration-tracker
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'MT_VERSION', '3.0.0' );
define( 'MT_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
define( 'MT_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

/* =========================================================================
   DATABASE
   ========================================================================= */

function mt_create_tables() {
    global $wpdb;
    $charset = $wpdb->get_charset_collate();
    $m = $wpdb->prefix . 'mt_migrations';
    $c = $wpdb->prefix . 'mt_changes';

    $sql = "CREATE TABLE {$m} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        label VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        PRIMARY KEY (id)
    ) {$charset};

    CREATE TABLE {$c} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        migration_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        notes TEXT,
        devices TEXT,
        attachments TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        warning TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY migration_id (migration_id)
    ) {$charset};";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( $sql );
}
register_activation_hook( __FILE__, 'mt_create_tables' );

/* =========================================================================
   ADMIN MENU
   ========================================================================= */

add_action( 'admin_menu', function () {
    add_menu_page( 'Build Tracker', 'Builds', 'manage_options', 'migration-tracker', 'mt_render_admin_page', 'dashicons-admin-tools', 30 );
});

/* =========================================================================
   ENQUEUE
   ========================================================================= */

add_action( 'admin_enqueue_scripts', function ( $hook ) {
    if ( $hook !== 'toplevel_page_migration-tracker' ) return;
    wp_enqueue_media();
    wp_enqueue_style( 'mt-admin', MT_PLUGIN_URL . 'assets/admin.css', [], MT_VERSION );
    wp_enqueue_script( 'mt-admin', MT_PLUGIN_URL . 'assets/admin.js', [ 'jquery' ], MT_VERSION, true );
    wp_localize_script( 'mt-admin', 'MT', [
        'ajax'  => admin_url( 'admin-ajax.php' ),
        'nonce' => wp_create_nonce( 'mt_nonce' ),
    ]);
});

/* =========================================================================
   RENDER
   ========================================================================= */

function mt_render_admin_page() {
    ?>
    <div id="mt-app" class="wrap mt-wrap">

        <div class="mt-header">
            <div class="mt-header__left">
                <svg class="mt-logo" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="6" fill="#E40589"/><path d="M7 10h14M7 14h14M7 18h8" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="21" cy="18" r="3" fill="#fff" opacity=".5"/></svg>
                <h1>Build Tracker</h1>
            </div>
            <button id="mt-new-migration-btn" class="mt-btn mt-btn--primary"><span class="dashicons dashicons-plus-alt2"></span> New Build</button>
        </div>

        <!-- BUILD LIST -->
        <div id="mt-list-view">
            <div id="mt-migrations-list" class="mt-migrations-list">
                <div class="mt-empty-state" id="mt-empty">
                    <svg viewBox="0 0 120 120" fill="none" class="mt-empty__icon"><rect x="10" y="30" width="100" height="70" rx="8" stroke="currentColor" stroke-width="2" fill="none" opacity=".3"/><path d="M30 55h60M30 70h40M30 85h50" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".25"/><path d="M50 10l10 20 10-20" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".4"/></svg>
                    <h2>No builds yet</h2>
                    <p>Create your first build to start tracking changes.</p>
                </div>
            </div>
        </div>

        <!-- DETAIL VIEW -->
        <div id="mt-detail-view" style="display:none;">
            <div class="mt-detail-topbar">
                <button id="mt-back-btn" class="mt-btn mt-btn--ghost"><span class="dashicons dashicons-arrow-left-alt2"></span> All Builds</button>
                <div class="mt-detail-meta">
                    <h2 id="mt-detail-label"></h2>
                    <span id="mt-detail-date" class="mt-detail-date"></span>
                </div>
            </div>

            <!-- PROGRESS BAR -->
            <div class="mt-progress-wrap">
                <div class="mt-progress-labels">
                    <span class="mt-progress-label" id="mt-progress-text">0 of 0 approved</span>
                    <span class="mt-progress-pct" id="mt-progress-pct">0%</span>
                </div>
                <div class="mt-progress-track">
                    <div class="mt-progress-bar" id="mt-progress-bar" style="width:0%"></div>
                </div>
                <div class="mt-progress-legend">
                    <span class="mt-legend-item"><span class="mt-legend-dot mt-legend-dot--completed"></span> Completed</span>
                    <span class="mt-legend-item"><span class="mt-legend-dot mt-legend-dot--approved"></span> Approved</span>
                    <span class="mt-legend-item"><span class="mt-legend-dot mt-legend-dot--testing"></span> Testing</span>
                </div>
            </div>

            <!-- ADD FORM -->
            <div class="mt-add-change">
                <input type="text" id="mt-change-title" placeholder="Describe a change…" autocomplete="off" />
                <textarea id="mt-change-desc" placeholder="Details (optional)" rows="1"></textarea>
                <label class="mt-checkbox-label" for="mt-change-warning"><input type="checkbox" id="mt-change-warning" /><span class="mt-checkbox-text">Warning – Test Data Analytics</span></label>
                <button id="mt-add-change-btn" class="mt-btn mt-btn--primary mt-btn--sm">Add Item</button>
            </div>

            <!-- BOARD -->
            <div class="mt-board">
                <div class="mt-col" id="mt-col-pending">
                    <div class="mt-col__header mt-col__header--pending"><span class="mt-col__dot mt-col__dot--pending"></span> Completed Items <span class="mt-col__count" id="mt-pending-count">0</span></div>
                    <div class="mt-col__body" id="mt-pending-body" data-status="pending"></div>
                </div>
                <div class="mt-col" id="mt-col-approved">
                    <div class="mt-col__header mt-col__header--approved"><span class="mt-col__dot mt-col__dot--approved"></span> Approved for Launch <span class="mt-col__count" id="mt-approved-count">0</span></div>
                    <div class="mt-col__body" id="mt-approved-body" data-status="approved"></div>
                </div>
                <div class="mt-col" id="mt-col-testing">
                    <div class="mt-col__header mt-col__header--testing"><span class="mt-col__dot mt-col__dot--testing"></span> Post-Launch Testing <span class="mt-col__count" id="mt-testing-count">0</span></div>
                    <div class="mt-col__body" id="mt-testing-body" data-status="testing"></div>
                </div>
            </div>
        </div>

        <!-- MODALS -->
        <div id="mt-modal-overlay" class="mt-modal-overlay" style="display:none;">
            <div class="mt-modal">
                <h3>Create New Build</h3>
                <label for="mt-migration-label">Build Label</label>
                <input type="text" id="mt-migration-label" placeholder='e.g. "Spring 2026 Redesign"' autocomplete="off" />
                <div class="mt-modal__actions"><button id="mt-modal-cancel" class="mt-btn mt-btn--ghost">Cancel</button><button id="mt-modal-create" class="mt-btn mt-btn--primary">Create Build</button></div>
            </div>
        </div>

        <div id="mt-notes-overlay" class="mt-modal-overlay" style="display:none;">
            <div class="mt-modal">
                <h3>Change Notes</h3>
                <textarea id="mt-notes-textarea" rows="5" placeholder="Add approval notes, conditions, or context…"></textarea>
                <div class="mt-modal__actions"><button id="mt-notes-cancel" class="mt-btn mt-btn--ghost">Cancel</button><button id="mt-notes-save" class="mt-btn mt-btn--primary">Save Notes</button></div>
            </div>
        </div>

        <div id="mt-devices-overlay" class="mt-modal-overlay" style="display:none;">
            <div class="mt-modal">
                <div class="mt-devices-modal-header">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mt-devices-icon"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                    <h3>Testing Devices</h3>
                </div>
                <p class="mt-devices-help">List the devices and browsers used to test this change post-launch. One per line.</p>
                <textarea id="mt-devices-textarea" rows="6" placeholder="e.g.&#10;iPhone 15 Pro — Safari 18&#10;MacBook Pro 14&quot; — Chrome 124&#10;Samsung Galaxy S24 — Chrome Mobile"></textarea>
                <div class="mt-modal__actions"><button id="mt-devices-cancel" class="mt-btn mt-btn--ghost">Cancel</button><button id="mt-devices-save" class="mt-btn mt-btn--primary">Save Devices</button></div>
            </div>
        </div>

        <div id="mt-attach-overlay" class="mt-modal-overlay" style="display:none;">
            <div class="mt-modal mt-modal--wide">
                <div class="mt-devices-modal-header"><span class="dashicons dashicons-paperclip" style="color:var(--mt-pink);font-size:22px;width:22px;height:22px;"></span><h3>Attachments</h3></div>
                <p class="mt-devices-help">Screenshots, PDFs, design files, or any reference material.</p>
                <div id="mt-attach-list" class="mt-attach-list"></div>
                <div class="mt-modal__actions" style="justify-content:space-between;"><button id="mt-attach-add" class="mt-btn mt-btn--primary mt-btn--sm"><span class="dashicons dashicons-upload"></span> Add Files</button><button id="mt-attach-close" class="mt-btn mt-btn--ghost">Done</button></div>
            </div>
        </div>

    </div>
    <?php
}

/* =========================================================================
   AJAX
   ========================================================================= */

function mt_check() {
    check_ajax_referer( 'mt_nonce', 'nonce' );
    if ( ! current_user_can( 'manage_options' ) ) wp_send_json_error( 'Unauthorized', 403 );
}

/* Builds */
add_action( 'wp_ajax_mt_create_migration', function () {
    mt_check(); global $wpdb;
    $label = sanitize_text_field( wp_unslash( $_POST['label'] ?? '' ) );
    if ( empty( $label ) ) wp_send_json_error( 'Label is required.' );
    $wpdb->insert( $wpdb->prefix . 'mt_migrations', [ 'label' => $label, 'created_at' => current_time( 'mysql' ) ] );
    wp_send_json_success( [ 'id' => $wpdb->insert_id, 'label' => $label, 'created_at' => current_time( 'mysql' ), 'status' => 'active' ] );
});

add_action( 'wp_ajax_mt_get_migrations', function () {
    mt_check(); global $wpdb;
    $rows = $wpdb->get_results(
        "SELECT m.*,
                (SELECT COUNT(*) FROM {$wpdb->prefix}mt_changes WHERE migration_id=m.id AND status='pending')  AS pending_count,
                (SELECT COUNT(*) FROM {$wpdb->prefix}mt_changes WHERE migration_id=m.id AND status='approved') AS approved_count,
                (SELECT COUNT(*) FROM {$wpdb->prefix}mt_changes WHERE migration_id=m.id AND status='testing')  AS testing_count
         FROM {$wpdb->prefix}mt_migrations m ORDER BY m.created_at DESC"
    );
    wp_send_json_success( $rows );
});

add_action( 'wp_ajax_mt_delete_migration', function () {
    mt_check(); global $wpdb;
    $id = absint( $_POST['id'] ?? 0 );
    $wpdb->delete( $wpdb->prefix . 'mt_changes', [ 'migration_id' => $id ] );
    $wpdb->delete( $wpdb->prefix . 'mt_migrations', [ 'id' => $id ] );
    wp_send_json_success();
});

/* Changes */
add_action( 'wp_ajax_mt_get_changes', function () {
    mt_check(); global $wpdb;
    $mid  = absint( $_POST['migration_id'] ?? 0 );
    $rows = $wpdb->get_results( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}mt_changes WHERE migration_id=%d ORDER BY sort_order ASC, id ASC", $mid ) );
    foreach ( $rows as &$row ) {
        $ids = json_decode( $row->attachments ?: '[]', true );
        $files = [];
        if ( is_array( $ids ) ) {
            foreach ( $ids as $att_id ) {
                $att_id = absint( $att_id );
                $url = wp_get_attachment_url( $att_id );
                if ( $url ) {
                    $files[] = [ 'id' => $att_id, 'url' => $url, 'filename' => basename( get_attached_file( $att_id ) ), 'thumb' => wp_attachment_is_image( $att_id ) ? wp_get_attachment_image_url( $att_id, 'thumbnail' ) : '', 'is_image' => wp_attachment_is_image( $att_id ) ];
                }
            }
        }
        $row->attachment_files = $files;
    }
    wp_send_json_success( $rows );
});

add_action( 'wp_ajax_mt_add_change', function () {
    mt_check(); global $wpdb;
    $mid = absint( $_POST['migration_id'] ?? 0 );
    $title = sanitize_text_field( wp_unslash( $_POST['title'] ?? '' ) );
    $desc = sanitize_textarea_field( wp_unslash( $_POST['description'] ?? '' ) );
    $warning = absint( $_POST['warning'] ?? 0 );
    if ( empty( $title ) ) wp_send_json_error( 'Title is required.' );
    $wpdb->insert( $wpdb->prefix . 'mt_changes', [ 'migration_id' => $mid, 'title' => $title, 'description' => $desc, 'warning' => $warning ? 1 : 0, 'attachments' => '[]', 'status' => 'pending', 'created_at' => current_time( 'mysql' ), 'updated_at' => current_time( 'mysql' ) ] );
    wp_send_json_success( [ 'id' => $wpdb->insert_id, 'migration_id' => $mid, 'title' => $title, 'description' => $desc, 'warning' => $warning ? 1 : 0, 'notes' => '', 'attachments' => '[]', 'attachment_files' => [], 'status' => 'pending', 'created_at' => current_time( 'mysql' ) ] );
});

add_action( 'wp_ajax_mt_update_change_status', function () {
    mt_check(); global $wpdb;
    $id = absint( $_POST['id'] ?? 0 );
    $status = sanitize_text_field( $_POST['status'] ?? 'pending' );
    if ( ! in_array( $status, [ 'pending', 'approved', 'testing' ], true ) ) wp_send_json_error( 'Invalid status.' );
    $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'status' => $status ], [ 'id' => $id ] );
    wp_send_json_success();
});

add_action( 'wp_ajax_mt_update_change_notes', function () {
    mt_check(); global $wpdb;
    $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'notes' => sanitize_textarea_field( wp_unslash( $_POST['notes'] ?? '' ) ) ], [ 'id' => absint( $_POST['id'] ?? 0 ) ] );
    wp_send_json_success();
});

add_action( 'wp_ajax_mt_delete_change', function () {
    mt_check(); global $wpdb;
    $wpdb->delete( $wpdb->prefix . 'mt_changes', [ 'id' => absint( $_POST['id'] ?? 0 ) ] );
    wp_send_json_success();
});

add_action( 'wp_ajax_mt_reorder_changes', function () {
    mt_check(); global $wpdb;
    $order = json_decode( wp_unslash( $_POST['order'] ?? '[]' ), true );
    if ( is_array( $order ) ) foreach ( $order as $i => $id ) $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'sort_order' => $i ], [ 'id' => absint( $id ) ] );
    wp_send_json_success();
});

add_action( 'wp_ajax_mt_toggle_warning', function () {
    mt_check(); global $wpdb;
    $id = absint( $_POST['id'] ?? 0 );
    $row = $wpdb->get_row( $wpdb->prepare( "SELECT warning FROM {$wpdb->prefix}mt_changes WHERE id=%d", $id ) );
    $new = $row && $row->warning ? 0 : 1;
    $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'warning' => $new ], [ 'id' => $id ] );
    wp_send_json_success( [ 'warning' => $new ] );
});

add_action( 'wp_ajax_mt_update_change_devices', function () {
    mt_check(); global $wpdb;
    $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'devices' => sanitize_textarea_field( wp_unslash( $_POST['devices'] ?? '' ) ) ], [ 'id' => absint( $_POST['id'] ?? 0 ) ] );
    wp_send_json_success();
});

add_action( 'wp_ajax_mt_update_attachments', function () {
    mt_check(); global $wpdb;
    $id = absint( $_POST['id'] ?? 0 );
    $ids = json_decode( wp_unslash( $_POST['attachment_ids'] ?? '[]' ), true );
    if ( ! is_array( $ids ) ) $ids = [];
    $ids = array_map( 'absint', $ids );
    $wpdb->update( $wpdb->prefix . 'mt_changes', [ 'attachments' => wp_json_encode( $ids ) ], [ 'id' => $id ] );
    $files = [];
    foreach ( $ids as $att_id ) {
        $url = wp_get_attachment_url( $att_id );
        if ( $url ) $files[] = [ 'id' => $att_id, 'url' => $url, 'filename' => basename( get_attached_file( $att_id ) ), 'thumb' => wp_attachment_is_image( $att_id ) ? wp_get_attachment_image_url( $att_id, 'thumbnail' ) : '', 'is_image' => wp_attachment_is_image( $att_id ) ];
    }
    wp_send_json_success( [ 'attachment_files' => $files ] );
});
