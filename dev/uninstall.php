<?php

if ( ! defined('WP_UNINSTALL_PLUGIN') ) {
    exit;
}

$delete = get_option('mt_delete_data_on_uninstall', 0);

if (!$delete) {
    return;
}

global $wpdb;

$changes = $wpdb->prefix . 'mt_changes';
$migrations = $wpdb->prefix . 'mt_migrations';

/* Optional attachment cleanup */
$rows = $wpdb->get_results("SELECT attachments FROM {$changes}");

if ($rows) {

    foreach ($rows as $row) {

        $ids = json_decode($row->attachments, true);

        if (is_array($ids)) {

            foreach ($ids as $id) {

                $id = absint($id);

                if (get_post($id)) {
                    wp_delete_attachment($id, true);
                }
            }
        }
    }
}

/* Drop tables */

$wpdb->query("DROP TABLE IF EXISTS {$changes}");
$wpdb->query("DROP TABLE IF EXISTS {$migrations}");

/* Remove options */

delete_option('mt_delete_data_on_uninstall');
delete_option('mt_version');
