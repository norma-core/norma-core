use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::os::unix::fs::OpenOptionsExt;

pub const KMSG_PATH: &str = "/dev/kmsg";
pub const RECORD_BUFFER_SIZE: usize = 8192;
pub const SUPPORTED: bool = cfg!(target_os = "linux");

pub enum ReadOutcome {
    Record(usize),
    Drained,
    Overrun,
    Oversized,
    Failed(std::io::Error),
}

pub struct KmsgSource {
    file: File,
}

impl KmsgSource {
    pub fn open(replay_backlog: bool) -> std::io::Result<Self> {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(KMSG_PATH)?;

        if !replay_backlog {
            file.seek(SeekFrom::End(0))?;
        }

        Ok(Self { file })
    }

    pub fn read_record(&mut self, buffer: &mut [u8]) -> ReadOutcome {
        loop {
            return match self.file.read(buffer) {
                Ok(0) => ReadOutcome::Drained,
                Ok(size) => ReadOutcome::Record(size),
                Err(err) => match err.kind() {
                    ErrorKind::WouldBlock => ReadOutcome::Drained,
                    ErrorKind::Interrupted => continue,
                    ErrorKind::BrokenPipe => ReadOutcome::Overrun,
                    ErrorKind::InvalidInput => ReadOutcome::Oversized,
                    _ => ReadOutcome::Failed(err),
                },
            };
        }
    }
}
