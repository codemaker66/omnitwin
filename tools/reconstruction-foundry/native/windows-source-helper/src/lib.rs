#![cfg_attr(not(windows), allow(dead_code))]
#![forbid(unsafe_op_in_unsafe_fn)]

#[cfg(not(all(windows, target_arch = "x86_64")))]
compile_error!("venviewer-windows-source-helper supports only x86_64 Windows");

pub mod custody;
pub mod data_plane_frame;
pub mod data_plane_io;
pub mod drop_target;
pub mod output;
pub mod path;
pub mod picker;
pub mod protocol;
pub mod scope;
pub mod source_catalog;
