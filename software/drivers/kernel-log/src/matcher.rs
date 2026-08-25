use crate::kernel_log_proto::KernelLogCategory;
use crate::parser::ParsedRecord;

struct Rule {
    subsystem: Option<&'static str>,
    needles: &'static [&'static str],
    category: KernelLogCategory,
}

const RULES: &[Rule] = &[
    Rule {
        subsystem: None,
        needles: &[
            "Out of memory",
            "invoked oom-killer",
            "oom_reaper",
            "oom-kill:",
        ],
        category: KernelLogCategory::Oom,
    },
    Rule {
        subsystem: None,
        needles: &["deferred probe", "deferred_probe"],
        category: KernelLogCategory::DeferredProbe,
    },
    Rule {
        subsystem: None,
        needles: &["x8h7"],
        category: KernelLogCategory::H7,
    },
    Rule {
        subsystem: None,
        needles: &["uvcvideo", "uvc_"],
        category: KernelLogCategory::Uvc,
    },
    Rule {
        subsystem: None,
        needles: &[
            "qmi_wwan",
            "cdc_mbim",
            "cdc_ncm",
            "cdc_ether",
            "usb_wwan",
            "GSM modem",
        ],
        category: KernelLogCategory::Modem,
    },
    Rule {
        subsystem: Some("mmc"),
        needles: &[
            "mmcblk",
            "blk_update_request",
            "Buffer I/O error",
            "critical medium error",
            "EXT4-fs error",
            "EXT4-fs warning",
            "F2FS-fs error",
            "I/O error",
        ],
        category: KernelLogCategory::Storage,
    },
    Rule {
        subsystem: Some("net"),
        needles: &[
            "ppp0",
            "pppd",
            "PPP ",
            "Link is Down",
            "link becomes not ready",
            "NETDEV WATCHDOG",
            "carrier lost",
        ],
        category: KernelLogCategory::Network,
    },
    Rule {
        subsystem: Some("usb"),
        needles: &[
            "USB disconnect",
            "device descriptor read",
            "device not accepting address",
            "unable to enumerate USB device",
            "reset high-speed USB",
            "reset full-speed USB",
        ],
        category: KernelLogCategory::Usb,
    },
];

pub fn classify(record: &ParsedRecord) -> KernelLogCategory {
    for rule in RULES {
        if let Some(subsystem) = rule.subsystem
            && record.subsystem == subsystem
        {
            return rule.category;
        }

        if rule
            .needles
            .iter()
            .any(|needle| record.message.contains(needle))
        {
            return rule.category;
        }
    }

    KernelLogCategory::Unspecified
}
