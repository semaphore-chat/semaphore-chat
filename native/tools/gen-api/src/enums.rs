//! `semaphore_wire::enums`: one tolerant type per named enum in the contract.

use crate::spec::{EnumDef, EnumKind, pascal_case};

/// Shared by every string enum. Keeping the shape in one macro keeps the generated module
/// small and the behaviour identical: unknown values are kept verbatim.
const STRING_ENUM_MACRO: &str = r#"/// One tolerant named enum.
///
/// The last variant holds a value this build does not know, verbatim, so a value a newer
/// server adds never fails a payload and serializes back exactly as it arrived.
macro_rules! tolerant_string_enum {
    (
        $(#[$meta:meta])*
        $name:ident {
            $($variant:ident = $wire:literal),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub enum $name {
            $(
                #[doc = concat!("`", $wire, "`")]
                $variant,
            )*
            /// A value this build does not know, kept exactly as it came off the wire.
            Unknown(::std::string::String),
        }

        impl $name {
            /// The string this value is sent and received as.
            pub fn as_str(&self) -> ::std::borrow::Cow<'_, str> {
                match self {
                    $(
                        Self::$variant => ::std::borrow::Cow::Borrowed($wire),
                    )*
                    Self::Unknown(raw) => ::std::borrow::Cow::Borrowed(raw.as_str()),
                }
            }
        }

        impl ::serde::Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> ::std::result::Result<S::Ok, S::Error>
            where
                S: ::serde::Serializer,
            {
                serializer.serialize_str(self.as_str().as_ref())
            }
        }

        impl<'de> ::serde::Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
            where
                D: ::serde::Deserializer<'de>,
            {
                struct Visitor;

                impl<'de> ::serde::de::Visitor<'de> for Visitor {
                    type Value = $name;

                    fn expecting(
                        &self,
                        formatter: &mut ::std::fmt::Formatter<'_>,
                    ) -> ::std::fmt::Result {
                        formatter.write_str(concat!(stringify!($name), " wire string"))
                    }

                    fn visit_str<E>(self, value: &str) -> ::std::result::Result<$name, E>
                    where
                        E: ::serde::de::Error,
                    {
                        ::std::result::Result::Ok(match value {
                            $(
                                $wire => $name::$variant,
                            )*
                            _ => $name::Unknown(value.to_owned()),
                        })
                    }

                    fn visit_string<E>(self, value: ::std::string::String)
                        -> ::std::result::Result<$name, E>
                    where
                        E: ::serde::de::Error,
                    {
                        ::std::result::Result::Ok(match value.as_str() {
                            $(
                                $wire => $name::$variant,
                            )*
                            _ => $name::Unknown(value),
                        })
                    }
                }

                deserializer.deserialize_str(Visitor)
            }
        }
    };
}
"#;

/// The integer form, for the one enum whose wire values are numbers.
const INTEGER_ENUM_MACRO: &str = r#"/// One tolerant named enum whose wire values are integers.
macro_rules! tolerant_integer_enum {
    (
        $(#[$meta:meta])*
        $name:ident {
            $($variant:ident = $value:literal),* $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub enum $name {
            $(
                #[doc = concat!("`", stringify!($value), "`")]
                $variant,
            )*
            /// A value this build does not know, kept exactly as it came off the wire.
            Unknown(i64),
        }

        impl $name {
            /// The string this value is sent and received as.
            pub fn as_str(&self) -> ::std::borrow::Cow<'_, str> {
                match self {
                    $(
                        Self::$variant => ::std::borrow::Cow::Borrowed(stringify!($value)),
                    )*
                    Self::Unknown(raw) => ::std::borrow::Cow::Owned(raw.to_string()),
                }
            }

            fn wire(&self) -> i64 {
                match *self {
                    $(
                        Self::$variant => $value,
                    )*
                    Self::Unknown(raw) => raw,
                }
            }
        }

        impl ::serde::Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> ::std::result::Result<S::Ok, S::Error>
            where
                S: ::serde::Serializer,
            {
                serializer.serialize_i64(self.wire())
            }
        }

        impl<'de> ::serde::Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> ::std::result::Result<Self, D::Error>
            where
                D: ::serde::Deserializer<'de>,
            {
                ::std::result::Result::Ok(
                    match <i64 as ::serde::Deserialize>::deserialize(deserializer)? {
                        $(
                            $value => $name::$variant,
                        )*
                        other => $name::Unknown(other),
                    },
                )
            }
        }
    };
}
"#;

/// The `pub mod enums` module: the two macros, then one invocation per named enum.
///
/// Returned as source text rather than a `syn::Item`: `macro_rules!` bodies do not survive
/// a round trip through a syntax tree, and the formatted source is the readable form.
pub fn module_source(enums: &[EnumDef]) -> String {
    // The macros sit at the top level of the file, where rustfmt keeps their bodies
    // readable: inside the module it re-indents the item but not the body.
    let mut source = String::from(STRING_ENUM_MACRO);
    source.push_str(INTEGER_ENUM_MACRO);
    source.push_str("pub mod enums {\n");

    for enum_def in enums {
        source.push_str(&invocation(enum_def));
    }

    source.push_str("}\n");
    source
}

fn invocation(enum_def: &EnumDef) -> String {
    let doc = doc(enum_def);
    let name = &enum_def.name;
    let mut source = String::new();
    match &enum_def.kind {
        EnumKind::String(values) => {
            source.push_str("tolerant_string_enum! {\n");
            source.push_str(&doc);
            source.push_str(&format!("    {name} {{\n"));
            for value in values {
                let variant = pascal_case(value);
                // `ErrorCode` has a wire value of `UNKNOWN`, which would collide with the
                // tolerant variant. Leave it to the tolerant variant: it round-trips the
                // same, and `ErrorCode::Unknown("UNKNOWN".into())` is what a client gets
                // either way.
                if variant == "Unknown" {
                    continue;
                }
                source.push_str(&format!("        {variant} = {value:?},\n"));
            }
            source.push_str("    }\n}\n\n");
        }
        EnumKind::Integer(values) => {
            source.push_str("tolerant_integer_enum! {\n");
            source.push_str(&doc);
            source.push_str(&format!("    {name} {{\n"));
            for value in values {
                source.push_str(&format!("        M{value} = {value},\n"));
            }
            source.push_str("    }\n}\n\n");
        }
    }
    source
}

fn doc(enum_def: &EnumDef) -> String {
    let mut text = format!("`{}`", enum_def.name);
    if let Some(description) = &enum_def.description {
        let description = description.split_whitespace().collect::<Vec<_>>().join(" ");
        if !description.is_empty() {
            text.push_str(": ");
            text.push_str(&description);
        }
    }
    format!("    /// {text}\n")
}
