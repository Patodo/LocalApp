use localapp_desktop::actions::{ActionStatus, ClaimedAction};
use localapp_desktop::local_store::LocalStore;
use localapp_desktop::paths::DesktopPaths;
use localapp_desktop::task_repository::TaskRepository;
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Duration;

const NOW: i64 = 1_752_494_400_000;

fn claimed_action(id: &str, status: ActionStatus) -> ClaimedAction {
    ClaimedAction {
        id: id.to_string(),
        server_origin: "https://work.example".to_string(),
        app_owner: "alice".to_string(),
        app_name: "reports".to_string(),
        app_version: Some("7".to_string()),
        publisher_user_id: "publisher-1".to_string(),
        publisher_display_name: Some("Release Publisher".to_string()),
        title: "Generate report".to_string(),
        description: Some("Build the workbook".to_string()),
        script: "return { ok: true };".to_string(),
        dependencies: BTreeMap::from([
            ("@localapp/report".to_string(), "1.2.3".to_string()),
            ("zod".to_string(), "4.0.0".to_string()),
        ]),
        input: json!({"month": "2026-07", "includeDrafts": false}),
        timeout_seconds: 45,
        status,
    }
}

fn repository() -> (tempfile::TempDir, LocalStore) {
    let directory = tempfile::tempdir().unwrap();
    let paths = DesktopPaths::from_root(directory.path().join("data"));
    let store = LocalStore::open(paths).unwrap();
    (directory, store)
}

#[test]
fn persists_the_complete_claim_and_creates_its_task_paths() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let action = claimed_action(
        "550e8400-e29b-41d4-a716-446655440000",
        ActionStatus::Claimed,
    );

    let persisted = repository.persist_claim(&action, NOW).unwrap();
    let loaded = repository.find(&action.id).unwrap().unwrap();

    assert_eq!(loaded, persisted);
    assert_eq!(loaded.request_id, action.id);
    assert_eq!(loaded.server_origin, action.server_origin);
    assert_eq!(loaded.app_owner, action.app_owner);
    assert_eq!(loaded.app_name, action.app_name);
    assert_eq!(loaded.app_version, action.app_version);
    assert_eq!(loaded.publisher_user_id, action.publisher_user_id);
    assert_eq!(loaded.publisher_display_name, action.publisher_display_name);
    assert_eq!(loaded.title, action.title);
    assert_eq!(loaded.description, action.description);
    assert_eq!(loaded.script, action.script);
    assert_eq!(loaded.dependencies, action.dependencies);
    assert_eq!(loaded.input, action.input);
    assert_eq!(loaded.timeout_seconds, action.timeout_seconds);
    assert_eq!(loaded.status, ActionStatus::Claimed);
    assert_eq!(loaded.created_at, NOW);
    assert_eq!(loaded.updated_at, NOW);
    assert_eq!(
        loaded.working_directory,
        store.paths().tasks().join(&action.id).join("work")
    );
    assert_eq!(
        loaded.stdout_path,
        store.paths().tasks().join(&action.id).join("stdout.log")
    );
    assert_eq!(
        loaded.stderr_path,
        store.paths().tasks().join(&action.id).join("stderr.log")
    );
    assert!(loaded.working_directory.is_dir());
    assert!(loaded.stdout_path.is_file());
    assert!(loaded.stderr_path.is_file());
}

#[test]
fn duplicate_claim_persistence_does_not_overwrite_a_terminal_task() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    let original = claimed_action(id, ActionStatus::Claimed);
    repository.persist_claim(&original, NOW).unwrap();
    repository
        .update_status(id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Running, NOW + 2)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Succeeded, NOW + 300_000)
        .unwrap();

    let mut duplicate = claimed_action(id, ActionStatus::Claimed);
    duplicate.script = "return 'replacement';".to_string();
    duplicate.title = "Replacement title".to_string();
    let persisted = repository.persist_claim(&duplicate, NOW + 600_000).unwrap();

    assert_eq!(persisted.status, ActionStatus::Succeeded);
    assert_eq!(persisted.script, original.script);
    assert_eq!(persisted.title, original.title);
    assert_eq!(persisted.updated_at, NOW + 300_000);
    assert_eq!(persisted.completed_at, Some(NOW + 300_000));
}

#[test]
fn startup_reconciliation_interrupts_active_execution_but_preserves_approval() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let awaiting_id = "11111111-1111-4111-8111-111111111111";
    let preparing_id = "22222222-2222-4222-8222-222222222222";
    let running_id = "33333333-3333-4333-8333-333333333333";

    repository
        .persist_claim(
            &claimed_action(awaiting_id, ActionStatus::AwaitingTrust),
            NOW,
        )
        .unwrap();
    repository
        .persist_claim(&claimed_action(preparing_id, ActionStatus::Preparing), NOW)
        .unwrap();
    repository
        .persist_claim(&claimed_action(running_id, ActionStatus::Running), NOW)
        .unwrap();

    assert_eq!(repository.reconcile_startup(NOW + 900_000).unwrap(), 2);
    assert_eq!(
        repository.find(awaiting_id).unwrap().unwrap().status,
        ActionStatus::AwaitingTrust
    );
    for id in [preparing_id, running_id] {
        let task = repository.find(id).unwrap().unwrap();
        assert_eq!(task.status, ActionStatus::Interrupted);
        assert_eq!(task.completed_at, Some(NOW + 900_000));
    }
}

#[test]
fn cleanup_deletes_only_unpinned_terminal_tasks_strictly_before_cutoff() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let old_id = "44444444-4444-4444-8444-444444444444";
    let boundary_id = "55555555-5555-4555-8555-555555555555";
    let pinned_id = "66666666-6666-4666-8666-666666666666";
    let waiting_id = "77777777-7777-4777-8777-777777777777";

    for id in [old_id, boundary_id, pinned_id, waiting_id] {
        repository
            .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
            .unwrap();
    }
    repository
        .update_status(old_id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    repository
        .update_status(old_id, ActionStatus::Running, NOW + 2)
        .unwrap();
    repository
        .update_status(old_id, ActionStatus::Succeeded, NOW - 2_678_400_000)
        .unwrap();
    repository
        .update_status(boundary_id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    repository
        .update_status(boundary_id, ActionStatus::Failed, NOW - 2_592_000_000)
        .unwrap();
    repository
        .update_status(pinned_id, ActionStatus::AwaitingTrust, NOW + 1)
        .unwrap();
    repository
        .update_status(pinned_id, ActionStatus::Cancelled, NOW - 3_715_200_000)
        .unwrap();
    repository.set_pinned(pinned_id, true, NOW).unwrap();
    repository
        .update_status(waiting_id, ActionStatus::AwaitingTrust, NOW - 3_715_200_000)
        .unwrap();

    assert_eq!(
        repository
            .cleanup_completed_before(NOW - 2_592_000_000)
            .unwrap(),
        1
    );
    assert!(repository.find(old_id).unwrap().is_none());
    assert!(!store.paths().tasks().join(old_id).exists());
    for id in [boundary_id, pinned_id, waiting_id] {
        assert!(repository.find(id).unwrap().is_some(), "missing {id}");
        assert!(
            store.paths().tasks().join(id).is_dir(),
            "missing {id} files"
        );
    }
    assert!(repository.find(pinned_id).unwrap().unwrap().pinned);
}

#[test]
fn status_transitions_follow_the_graph_and_same_status_is_idempotent() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "88888888-8888-4888-8888-888888888888";
    repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();

    let unchanged = repository
        .update_status(id, ActionStatus::Claimed, NOW + 1)
        .unwrap();
    assert_eq!(unchanged.updated_at, NOW);
    assert!(
        repository
            .update_status(id, ActionStatus::Running, NOW + 2)
            .is_err()
    );
    repository
        .update_status(id, ActionStatus::AwaitingTrust, NOW + 3)
        .unwrap();
    assert!(
        repository
            .update_status(id, ActionStatus::Succeeded, NOW + 4)
            .is_err()
    );
    repository
        .update_status(id, ActionStatus::Preparing, NOW + 5)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Running, NOW + 6)
        .unwrap();
    assert!(
        repository
            .update_status(id, ActionStatus::Expired, NOW + 7)
            .is_err()
    );

    let cancelled_id = "89898989-8989-4989-8989-898989898989";
    repository
        .persist_claim(&claimed_action(cancelled_id, ActionStatus::Claimed), NOW)
        .unwrap();
    repository
        .update_status(cancelled_id, ActionStatus::Cancelled, NOW + 8)
        .unwrap();
}

#[test]
fn terminal_outcomes_are_persisted_atomically_and_first_terminal_result_wins() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let success_id = "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a";
    repository
        .persist_claim(&claimed_action(success_id, ActionStatus::Claimed), NOW)
        .unwrap();
    repository
        .update_status(success_id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    repository
        .update_status(success_id, ActionStatus::Running, NOW + 2)
        .unwrap();

    let completed = repository
        .complete(
            success_id,
            ActionStatus::Succeeded,
            Some(&json!({"answer": 42})),
            None,
            None,
            NOW + 3,
        )
        .unwrap();
    assert_eq!(completed.result, Some(json!({"answer": 42})));
    assert_eq!(completed.error_code, None);
    assert_eq!(completed.completed_at, Some(NOW + 3));
    assert_eq!(
        repository
            .pending_server_syncs()
            .unwrap()
            .into_iter()
            .map(|task| task.request_id)
            .collect::<Vec<_>>(),
        vec![success_id]
    );
    repository
        .mark_server_synced(success_id, ActionStatus::Succeeded)
        .unwrap();
    assert!(repository.pending_server_syncs().unwrap().is_empty());

    let repeated = repository
        .complete(
            success_id,
            ActionStatus::Succeeded,
            Some(&json!({"answer": 99})),
            None,
            None,
            NOW + 4,
        )
        .unwrap();
    assert_eq!(repeated.result, Some(json!({"answer": 42})));
    assert_eq!(repeated.updated_at, NOW + 3);

    let failure_id = "8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b";
    repository
        .persist_claim(&claimed_action(failure_id, ActionStatus::Claimed), NOW)
        .unwrap();
    repository
        .update_status(failure_id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    let failed = repository
        .complete(
            failure_id,
            ActionStatus::Failed,
            None,
            Some("dependency_prepare_failed"),
            Some("Could not install exact dependencies"),
            NOW + 2,
        )
        .unwrap();
    assert_eq!(
        failed.error_code.as_deref(),
        Some("dependency_prepare_failed")
    );
    assert_eq!(
        failed.error_summary.as_deref(),
        Some("Could not install exact dependencies")
    );
    assert!(failed.result.is_none());
}

#[test]
fn reads_bounded_log_tails_without_exposing_arbitrary_paths() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c";
    let task = repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();
    let prefix = vec![b'x'; 300 * 1024];
    let mut stdout = fs::OpenOptions::new()
        .append(true)
        .open(&task.stdout_path)
        .unwrap();
    stdout.write_all(&prefix).unwrap();
    stdout.write_all("\n最后一行\n".as_bytes()).unwrap();
    fs::write(&task.stderr_path, "warning\n").unwrap();

    let logs = repository.read_logs(id).unwrap();
    assert!(logs.stdout_truncated);
    assert!(logs.stdout.ends_with("\n最后一行\n"));
    assert!(logs.stdout.len() <= 256 * 1024 + 3);
    assert_eq!(logs.stderr, "warning\n");
    assert!(!logs.stderr_truncated);
    assert!(repository.read_logs("../desktop.sqlite3").is_err());
}

#[test]
fn concurrent_terminal_transitions_use_compare_and_swap() {
    let (_directory, store) = repository();
    let store = Arc::new(store);
    let id = "99999999-9999-4999-8999-999999999999";
    let repository = TaskRepository::new(&store);
    repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Preparing, NOW + 1)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Running, NOW + 2)
        .unwrap();

    let barrier = Arc::new(Barrier::new(5));
    let statuses = [
        ActionStatus::Succeeded,
        ActionStatus::Failed,
        ActionStatus::Cancelled,
        ActionStatus::Interrupted,
    ];
    let handles: Vec<_> = statuses
        .into_iter()
        .enumerate()
        .map(|(index, status)| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                TaskRepository::new(&store).update_status(id, status, NOW + 10 + index as i64)
            })
        })
        .collect();
    barrier.wait();
    let successful = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .filter(Result::is_ok)
        .count();

    assert_eq!(successful, 1);
    assert!(matches!(
        repository.find(id).unwrap().unwrap().status,
        ActionStatus::Succeeded
            | ActionStatus::Failed
            | ActionStatus::Cancelled
            | ActionStatus::Interrupted
    ));
}

#[test]
fn cleanup_loses_ownership_when_a_concurrent_pin_commits() {
    let (directory, store) = repository();
    let store = Arc::new(store);
    let id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let repository = TaskRepository::new(&store);
    repository
        .persist_claim(&claimed_action(id, ActionStatus::Running), NOW)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Succeeded, NOW - 10)
        .unwrap();

    let connection = rusqlite::Connection::open(store.paths().database()).unwrap();
    connection.busy_timeout(Duration::from_secs(5)).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    connection
        .execute(
            "UPDATE local_tasks SET pinned = 1 WHERE request_id = ?",
            [id],
        )
        .unwrap();

    let cleanup_store = Arc::clone(&store);
    let cleanup =
        thread::spawn(move || TaskRepository::new(&cleanup_store).cleanup_completed_before(NOW));
    thread::sleep(Duration::from_millis(100));
    connection.execute_batch("COMMIT").unwrap();

    assert_eq!(cleanup.join().unwrap().unwrap(), 0);
    let task = repository.find(id).unwrap().unwrap();
    assert!(task.pinned);
    assert!(directory.path().join("data/tasks").join(id).is_dir());
}

#[test]
fn cleanup_is_retryable_after_a_filesystem_failure() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    repository
        .persist_claim(&claimed_action(id, ActionStatus::Running), NOW)
        .unwrap();
    repository
        .update_status(id, ActionStatus::Failed, NOW - 10)
        .unwrap();
    let trash = store.paths().tasks().join(".trash");
    fs::write(&trash, "blocks trash directory creation").unwrap();

    assert!(repository.cleanup_completed_before(NOW).is_err());
    assert!(repository.find(id).unwrap().is_some());
    assert!(store.paths().tasks().join(id).is_dir());

    fs::remove_file(trash).unwrap();
    assert_eq!(repository.cleanup_completed_before(NOW).unwrap(), 1);
    assert!(repository.find(id).unwrap().is_none());
}

#[test]
fn startup_recovers_stale_trash_when_the_row_survived() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();
    let active = store.paths().tasks().join(id);
    let trash_root = store.paths().tasks().join(".trash");
    fs::create_dir(&trash_root).unwrap();
    fs::rename(&active, trash_root.join(id)).unwrap();

    repository.reconcile_startup(NOW + 1).unwrap();

    assert!(repository.find(id).unwrap().is_some());
    assert!(active.is_dir());
    assert!(!trash_root.join(id).exists());
}

#[test]
fn timestamps_round_trip_the_full_i64_range_and_list_newest_first() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let oldest = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let newest = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    repository
        .persist_claim(&claimed_action(oldest, ActionStatus::Claimed), i64::MIN)
        .unwrap();
    repository
        .persist_claim(&claimed_action(newest, ActionStatus::Claimed), i64::MAX)
        .unwrap();

    assert_eq!(
        repository.find(oldest).unwrap().unwrap().created_at,
        i64::MIN
    );
    assert_eq!(
        repository.find(newest).unwrap().unwrap().created_at,
        i64::MAX
    );
    let listed = repository.list().unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|task| task.request_id.as_str())
            .collect::<Vec<_>>(),
        vec![newest, oldest]
    );
}

#[test]
fn serializes_tauri_shape_with_id_and_exact_paths() {
    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let task = repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();

    let serialized = serde_json::to_value(task).unwrap();
    assert_eq!(serialized["id"], id);
    assert!(serialized.get("requestId").is_none());
    assert_eq!(
        serialized["workingDirectory"],
        store
            .paths()
            .tasks()
            .join(id)
            .join("work")
            .to_str()
            .unwrap()
    );
    assert_eq!(serialized["createdAt"], NOW);
}

#[cfg(unix)]
#[test]
fn serialization_rejects_non_utf8_paths() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let (_directory, store) = repository();
    let repository = TaskRepository::new(&store);
    let id = "01234567-89ab-4cde-8fab-0123456789ab";
    let mut task = repository
        .persist_claim(&claimed_action(id, ActionStatus::Claimed), NOW)
        .unwrap();
    task.working_directory = OsString::from_vec(vec![0xff]).into();

    assert!(serde_json::to_value(task).is_err());
}
