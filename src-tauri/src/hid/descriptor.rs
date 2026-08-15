//! Minimal HID Report Descriptor parser.
//!
//! `hidapi`'s enumeration only exposes a device's *top-level* usage_page/usage
//! (one hidapi "device" per top-level collection — the same granularity
//! WebHID uses). It does not parse the descriptor into the input/output/
//! feature report tree the frontend drivers inspect via `HIDDevice.collections`
//! (see `mouse-types.ts` and the `isSupported()` / `describeHidDevice()`
//! helpers in each `*-hid.ts` file). This module rebuilds that tree from the
//! raw descriptor bytes (`HidDevice::get_report_descriptor`) so native mode
//! can hand the frontend the same shape a browser would, letting
//! `hardware/native.ts` satisfy the `HIDDevice` interface without the
//! per-driver support-detection logic needing to change.
//!
//! Only short items are handled — long items (prefix 0xFE) are vanishingly
//! rare in practice for HID mice and are skipped rather than interpreted.
//! Reference: USB HID spec v1.11 §6.2.2.
//!
//! NOTE: written without a Rust toolchain available to compile/test it in
//! this environment — review it against a real descriptor dump (see
//! `hid_open`'s doc comment) before shipping.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct ReportItem {
    #[serde(rename = "reportSize")]
    pub report_size: u32,
    #[serde(rename = "reportCount")]
    pub report_count: u32,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct ReportInfo {
    #[serde(rename = "reportId")]
    pub report_id: u32,
    pub items: Vec<ReportItem>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct CollectionInfo {
    #[serde(rename = "usagePage")]
    pub usage_page: u32,
    pub usage: u32,
    #[serde(rename = "inputReports")]
    pub input_reports: Vec<ReportInfo>,
    #[serde(rename = "outputReports")]
    pub output_reports: Vec<ReportInfo>,
    #[serde(rename = "featureReports")]
    pub feature_reports: Vec<ReportInfo>,
    pub children: Vec<CollectionInfo>,
}

#[derive(Clone, Default)]
struct GlobalState {
    usage_page: u32,
    report_size: u32,
    report_count: u32,
    report_id: u32,
}

enum ReportKind {
    Input,
    Output,
    Feature,
}

fn push_report(list: &mut Vec<ReportInfo>, report_id: u32, item: ReportItem) {
    if let Some(existing) = list.iter_mut().find(|r| r.report_id == report_id) {
        existing.items.push(item);
    } else {
        list.push(ReportInfo { report_id, items: vec![item] });
    }
}

/// Parse a raw HID report descriptor into the same tree shape as
/// `HIDDevice.collections`. Malformed input degrades gracefully — parsing
/// stops at the first byte it can't interpret and returns whatever
/// collections were already closed, rather than panicking.
pub fn parse(descriptor: &[u8]) -> Vec<CollectionInfo> {
    let mut root: Vec<CollectionInfo> = Vec::new();
    // Stack of currently-open collections, outermost first.
    let mut stack: Vec<CollectionInfo> = Vec::new();
    let mut global = GlobalState::default();
    let mut global_stack: Vec<GlobalState> = Vec::new();
    // Local Usage state: only the first Usage before the next Main item
    // matters here, since it's the one a following Collection() attaches to.
    let mut pending_usage: Option<u32> = None;

    let mut i = 0usize;
    while i < descriptor.len() {
        let prefix = descriptor[i];

        if prefix == 0xFE {
            // Long item: 0xFE, data-size byte, tag byte, then data-size bytes.
            if i + 1 >= descriptor.len() {
                break;
            }
            let data_size = descriptor[i + 1] as usize;
            i += 3 + data_size;
            continue;
        }

        let size_code = prefix & 0b0000_0011;
        let item_type = (prefix >> 2) & 0b0000_0011;
        let tag = (prefix >> 4) & 0b0000_1111;
        let data_len = match size_code {
            0 => 0,
            1 => 1,
            2 => 2,
            _ => 4,
        };
        if i + 1 + data_len > descriptor.len() {
            break;
        }
        let data = &descriptor[i + 1..i + 1 + data_len];
        let value: u32 = data.iter().rev().fold(0u32, |acc, &b| (acc << 8) | b as u32);
        i += 1 + data_len;

        match item_type {
            // Global item.
            1 => match tag {
                0 => global.usage_page = value,
                7 => global.report_size = value,
                8 => global.report_id = value,
                9 => global.report_count = value,
                10 => global_stack.push(global.clone()),
                11 => {
                    if let Some(saved) = global_stack.pop() {
                        global = saved;
                    }
                }
                _ => {}
            },
            // Local item.
            2 => {
                if tag == 0 && pending_usage.is_none() {
                    pending_usage = Some(value);
                }
            }
            // Main item.
            0 => {
                match tag {
                    // Collection
                    10 => stack.push(CollectionInfo {
                        usage_page: global.usage_page,
                        usage: pending_usage.unwrap_or(0),
                        ..Default::default()
                    }),
                    // End Collection
                    12 => {
                        if let Some(finished) = stack.pop() {
                            match stack.last_mut() {
                                Some(parent) => parent.children.push(finished),
                                None => root.push(finished),
                            }
                        }
                    }
                    // Input / Output / Feature
                    8 | 9 | 11 => {
                        let kind = match tag {
                            8 => ReportKind::Input,
                            9 => ReportKind::Output,
                            _ => ReportKind::Feature,
                        };
                        if let Some(current) = stack.last_mut() {
                            let item = ReportItem {
                                report_size: global.report_size,
                                report_count: global.report_count,
                            };
                            let list = match kind {
                                ReportKind::Input => &mut current.input_reports,
                                ReportKind::Output => &mut current.output_reports,
                                ReportKind::Feature => &mut current.feature_reports,
                            };
                            push_report(list, global.report_id, item);
                        }
                    }
                    _ => {}
                }
                // All Main items clear local state (HID spec §6.2.2.8).
                pending_usage = None;
            }
            _ => {}
        }
    }

    // Flush any collections left open by a truncated/malformed descriptor
    // instead of silently dropping their reports.
    while let Some(finished) = stack.pop() {
        match stack.last_mut() {
            Some(parent) => parent.children.push(finished),
            None => root.push(finished),
        }
    }

    root
}

/// Byte length of a report by id, searched recursively across the whole
/// collection tree. Mirrors `reportPayloadLength()` in `egg-we-hid.ts`. Used
/// to size buffers for `hid_receive_feature_report` without the JS caller
/// needing to know the descriptor.
pub fn feature_report_length(collections: &[CollectionInfo], report_id: u32) -> Option<usize> {
    fn visit(collections: &[CollectionInfo], report_id: u32) -> Option<usize> {
        for collection in collections {
            if let Some(report) = collection.feature_reports.iter().find(|r| r.report_id == report_id) {
                let bits: u32 = report.items.iter().map(|i| i.report_size * i.report_count).sum();
                return Some(((bits + 7) / 8) as usize);
            }
            if let Some(found) = visit(&collection.children, report_id) {
                return Some(found);
            }
        }
        None
    }
    visit(collections, report_id)
}
