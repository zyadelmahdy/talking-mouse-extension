// =============================================================================
// feature_spec.js — REAL spec. Mirrors feature_spec.json exactly.
// Order MUST match arousal_rf.js's input indices (0-34).
// =============================================================================

const FEATURE_SPEC = {
  feature_names: [
    "velocity_mean_mean",        // 0
    "velocity_mean_std",         // 1
    "velocity_std_mean",         // 2
    "velocity_std_std",          // 3
    "velocity_max_mean",         // 4
    "velocity_max_std",          // 5
    "velocity_p95_mean",         // 6
    "velocity_p95_std",          // 7
    "acceleration_mean_mean",    // 8
    "acceleration_mean_std",     // 9
    "acceleration_std_mean",     // 10
    "acceleration_std_std",      // 11
    "path_length_mean",          // 12
    "path_length_std",           // 13
    "direct_distance_mean",      // 14
    "direct_distance_std",       // 15
    "straightness_ratio_mean",   // 16
    "straightness_ratio_std",    // 17
    "direction_changes_mean",    // 18
    "direction_changes_std",     // 19
    "time_to_first_move_mean",   // 20
    "time_to_first_move_std",    // 21
    "trial_duration_mean",       // 22
    "trial_duration_std",        // 23
    "click_duration_mean",       // 24
    "click_duration_std",        // 25
    "idle_gaps_count_mean",      // 26
    "idle_gaps_count_std",       // 27
    "idle_gaps_total_sec_mean",  // 28
    "idle_gaps_total_sec_std",   // 29
    "hover_time_total_mean",     // 30
    "hover_time_total_std",      // 31
    "stimulus_reentries_mean",   // 32
    "stimulus_reentries_std",    // 33
    "correctness_rate",          // 34
  ],
};

self.FEATURE_SPEC = FEATURE_SPEC;
