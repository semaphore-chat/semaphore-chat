//! The screenshot rig's parts that other rigs reuse: the step language, the driver that runs the
//! steps any window understands, and comparing the renders of the same story.

pub mod compare;
pub mod driver;
pub mod script;
