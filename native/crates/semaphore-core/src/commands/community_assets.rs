//! A community's mention groups, custom emoji, soundboard sounds, webhooks and invites. Unit W5-A.
//!
//! The server sends no socket event for any of these changing (#681, #682), so their views read
//! again after this user's own changes, when shown and older than 30 s (`ADMIN_STALE_MS`), and on
//! a new connection (W2's rule). A removal or rename shows at once and goes back if the server
//! refuses; something new shows once the server agrees. Sounds are W4's `Core::soundboard` list;
//! their changes show on `CommunitySettings`' `op`.

use super::community_admin::{admin_keys as k, invalid, uuid};
use crate::cache::keys;
use crate::client::{Core, State};
use crate::model::{
    AliasGroupRow, AliasGroupView, AliasGroupsView, CreatedWebhook, CustomEmojiRow,
    CustomEmojiView, DraftFile, InviteDraft, InviteRow, InvitesView, SoundDraft, UserView, ViewKey,
    WebhookRow, WebhooksView,
};
use crate::platform::CoreError;
use semaphore_wire::enums::ResourceType;
use semaphore_wire::types as wire;

/// The backend's `CUSTOM_EMOJI_NAME_REGEX`: `^(?=.*[a-z])[a-z0-9_]{2,32}$`.
pub(crate) fn emoji_name_ok(name: &str) -> bool {
    (2..=32).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
        && name.bytes().any(|byte| byte.is_ascii_lowercase())
}

fn alias_member(member: &wire::AliasGroupMemberDto) -> UserView {
    UserView {
        id: member.id.clone(),
        username: member.username.clone(),
        display_name: member.display_name.clone(),
        avatar_file_id: member.avatar_url.clone().filter(|id| !id.is_empty()),
    }
}

fn summary(group: &wire::AliasGroupWithMembersDto) -> wire::AliasGroupSummaryDto {
    wire::AliasGroupSummaryDto {
        community_id: group.community_id.clone(),
        id: group.id.clone(),
        member_count: group.member_count,
        name: group.name.clone(),
    }
}

fn uuids(ids: &[String]) -> Result<Vec<uuid::Uuid>, CoreError> {
    ids.iter().map(|id| uuid(id, "a member")).collect()
}

impl State {
    /// The community a mention group belongs to, from its own read or a list naming it.
    fn alias_group_community(&self, group_id: &str) -> Option<String> {
        if let Some(group) = self.w5a_alias_group(&keys::scoped(k::ALIAS_GROUP, group_id)) {
            return Some(group.community_id.clone());
        }
        self.cache
            .keys_with_op(k::ALIAS_GROUPS)
            .into_iter()
            .find_map(|key| {
                self.w5a_alias_groups(&key)?
                    .iter()
                    .find(|group| group.id == group_id)
                    .map(|group| group.community_id.clone())
            })
    }

    /// Renames a group wherever it's cached, when its name is still `from`.
    fn alias_group_named(&mut self, group_id: &str, from: Option<&str>, to: &str) {
        let renames = |name: &mut String| {
            if from.is_none_or(|from| name == from) {
                *name = to.to_owned();
            }
        };
        self.w5a_alias_group_edit(&keys::scoped(k::ALIAS_GROUP, group_id), |group| {
            renames(&mut group.name)
        });
        for key in self.cache.keys_with_op(k::ALIAS_GROUPS) {
            self.w5a_alias_groups_edit(&key, |groups| {
                for group in groups.iter_mut().filter(|group| group.id == group_id) {
                    renames(&mut group.name);
                }
            });
        }
    }
}

impl Core {
    /// `ViewKey::AliasGroups`.
    pub fn alias_groups(&self, community_id: String) -> AliasGroupsView {
        self.write(|state, now| {
            let key = keys::scoped(k::ALIAS_GROUPS, &community_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::AliasGroups {
                community_id: community_id.clone(),
            };
            AliasGroupsView {
                state: state.query_load_state(&key),
                groups: state
                    .w5a_alias_groups(&key)
                    .map(|groups| {
                        groups
                            .iter()
                            .map(|group| AliasGroupRow {
                                id: group.id.clone(),
                                name: group.name.clone(),
                                member_count: group.member_count.clamp(0, i64::from(u32::MAX))
                                    as u32,
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                op: state.w5a_op(&view),
                community_id,
            }
        })
    }

    /// One group with its members, for the editor (`ViewKey::AliasGroup`).
    pub fn alias_group(&self, group_id: String) -> AliasGroupView {
        self.write(|state, now| {
            let key = keys::scoped(k::ALIAS_GROUP, &group_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::AliasGroup {
                group_id: group_id.clone(),
            };
            let group = state.w5a_alias_group(&key);
            AliasGroupView {
                state: state.query_load_state(&key),
                name: group.map(|group| group.name.clone()).unwrap_or_default(),
                members: group
                    .map(|group| group.members.iter().map(alias_member).collect())
                    .unwrap_or_default(),
                op: state.w5a_op(&view),
                group_id,
            }
        })
    }

    /// Makes a mention group; returns its id. Its name is 1 to 50 letters, digits, `_` or `-`.
    pub async fn create_alias_group(
        &self,
        community_id: String,
        name: String,
        member_ids: Vec<String>,
    ) -> Result<String, CoreError> {
        let view = ViewKey::AliasGroups {
            community_id: community_id.clone(),
        };
        let body = name
            .trim()
            .parse::<wire::CreateAliasGroupDtoName>()
            .map_err(|_| invalid("group name"))
            .and_then(|name| {
                Ok(wire::CreateAliasGroupDto {
                    member_ids: uuids(&member_ids)?,
                    name,
                })
            });
        let body = match body {
            Ok(body) => body,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating a mention group")?;
        let result = services
            .backend
            .alias_groups_controller_create_alias_group(community_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, now, group| {
                state.w5a_alias_groups_edit(&keys::scoped(k::ALIAS_GROUPS, &community_id), |groups| {
                    if !groups.iter().any(|known| known.id == group.id) {
                        groups.push(summary(group));
                        groups.sort_by(|a, b| a.name.cmp(&b.name));
                    }
                });
                state.cache.set(
                    keys::scoped(k::ALIAS_GROUP, &group.id),
                    crate::cache::CacheValue::W5a(super::community_admin::W5aValue::AliasGroup(
                        group.clone(),
                    )),
                    now,
                );
            },
            |_| {},
        )
        .map(|group| group.id)
    }

    /// Renames a group: shown at once, back if the server refuses.
    pub async fn rename_alias_group(&self, group_id: String, name: String) -> Result<(), CoreError> {
        let view = ViewKey::AliasGroup {
            group_id: group_id.clone(),
        };
        let body = match name.trim().parse::<wire::UpdateAliasGroupDtoName>() {
            Ok(name) => wire::UpdateAliasGroupDto { name },
            Err(_) => return self.w5a_refuse(&view, invalid("group name")),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "renaming a mention group")?;
        let new = body.name.to_string();
        let old = self.write(|state, _| {
            let old = state
                .w5a_alias_group(&keys::scoped(k::ALIAS_GROUP, &group_id))
                .map(|group| group.name.clone());
            state.alias_group_named(&group_id, None, &new);
            old
        });
        let result = services
            .backend
            .alias_groups_controller_update_alias_group(group_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, now, group| {
                let key = keys::scoped(k::ALIAS_GROUP, &group_id);
                state.note_direct_update(&key);
                state.cache.set(
                    key,
                    crate::cache::CacheValue::W5a(super::community_admin::W5aValue::AliasGroup(
                        group.clone(),
                    )),
                    now,
                );
                state.alias_group_named(&group_id, None, &group.name);
                state.view_changed(view.clone());
            },
            |state| {
                if let Some(old) = &old {
                    state.alias_group_named(&group_id, Some(&new), old);
                }
            },
        )
        .map(|_| ())
    }

    /// Deletes a group: it leaves the list at once, back if the server refuses.
    pub async fn delete_alias_group(&self, group_id: String) -> Result<(), CoreError> {
        let community_id = self
            .read(|state| state.alias_group_community(&group_id))
            .unwrap_or_default();
        let view = ViewKey::AliasGroups {
            community_id: community_id.clone(),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a mention group")?;
        let list = keys::scoped(k::ALIAS_GROUPS, &community_id);
        let removed = self.write(|state, _| {
            state
                .w5a_alias_groups_edit(&list, |groups| {
                    let index = groups.iter().position(|group| group.id == group_id)?;
                    Some((index, groups.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .alias_groups_controller_delete_alias_group(group_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| {
                state
                    .cache
                    .remove_prefix(&keys::scoped(k::ALIAS_GROUP, &group_id));
                state.view_changed(ViewKey::AliasGroup {
                    group_id: group_id.clone(),
                });
            },
            |state| {
                let Some((index, group)) = removed else { return };
                state.w5a_alias_groups_edit(&list, |groups| {
                    if !groups.iter().any(|known| known.id == group.id) {
                        groups.insert(index.min(groups.len()), group);
                    }
                });
            },
        )
    }

    /// Runs one change to a group's members, then reads the group and its community's list again.
    async fn alias_members_change(
        &self,
        group_id: &str,
        what: &str,
        call: impl AsyncFnOnce(&crate::client::Services) -> crate::backend::BackendResult<()>,
    ) -> Result<(), CoreError> {
        let view = ViewKey::AliasGroup {
            group_id: group_id.to_owned(),
        };
        let (services, epoch, change) = self.w5a_begin(&view, what)?;
        let result = call(&services).await;
        let community = self.read(|state| state.alias_group_community(group_id));
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| {
                state.w5a_reread(&keys::scoped(k::ALIAS_GROUP, group_id));
                if let Some(community) = &community {
                    state.w5a_reread(&keys::scoped(k::ALIAS_GROUPS, community));
                }
            },
            |_| {},
        )
    }

    /// Replaces the group's members.
    pub async fn set_alias_group_members(
        &self,
        group_id: String,
        member_ids: Vec<String>,
    ) -> Result<(), CoreError> {
        let view = ViewKey::AliasGroup {
            group_id: group_id.clone(),
        };
        let member_ids = match uuids(&member_ids) {
            Ok(ids) => ids,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        self.alias_members_change(&group_id, "changing a mention group", async |services| {
            services
                .backend
                .alias_groups_controller_update_members(
                    group_id.clone(),
                    wire::UpdateMembersDto { member_ids },
                )
                .await
        })
        .await
    }

    /// Adds one member to the group (they must be in the community).
    pub async fn add_alias_group_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        let view = ViewKey::AliasGroup {
            group_id: group_id.clone(),
        };
        let user = match uuid(&user_id, "the user") {
            Ok(user) => user,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        self.alias_members_change(&group_id, "adding to a mention group", async |services| {
            services
                .backend
                .alias_groups_controller_add_member(
                    group_id.clone(),
                    wire::AddMemberDto { user_id: user },
                )
                .await
        })
        .await
    }

    /// Takes one member out of the group.
    pub async fn remove_alias_group_member(
        &self,
        group_id: String,
        user_id: String,
    ) -> Result<(), CoreError> {
        self.alias_members_change(
            &group_id,
            "removing from a mention group",
            async |services| {
                services
                    .backend
                    .alias_groups_controller_remove_member(group_id.clone(), user_id.clone())
                    .await
            },
        )
        .await
    }

    /// The emoji tab (`ViewKey::CustomEmoji`), by name.
    pub fn custom_emoji(&self, community_id: String) -> CustomEmojiView {
        self.write(|state, now| {
            let key = keys::scoped(k::EMOJIS, &community_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::CustomEmoji {
                community_id: community_id.clone(),
            };
            CustomEmojiView {
                state: state.query_load_state(&key),
                emojis: state
                    .cache
                    .emojis(&key)
                    .map(|emojis| {
                        emojis
                            .iter()
                            .map(|emoji| CustomEmojiRow {
                                id: emoji.id.clone(),
                                name: emoji.name.clone(),
                                file_id: emoji.file_id.clone(),
                                created_by: emoji
                                    .created_by
                                    .as_deref()
                                    .map(|id| state.user_or_stub(id)),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                op: state.w5a_op(&view),
                community_id,
            }
        })
    }

    /// Uploads the image (progress in the view's `op.upload`), then adds it as `:name:`: 2 to 32
    /// lowercase letters, digits or `_`, at least one letter.
    pub async fn add_custom_emoji(
        &self,
        community_id: String,
        name: String,
        file: DraftFile,
    ) -> Result<(), CoreError> {
        let view = ViewKey::CustomEmoji {
            community_id: community_id.clone(),
        };
        let name = name.trim().trim_matches(':').to_owned();
        if !emoji_name_ok(&name) {
            return self.w5a_refuse(&view, invalid("emoji name"));
        }
        let (services, epoch, change) = self.w5a_begin(&view, "adding a custom emoji")?;
        let uploaded = self
            .w5a_upload(
                &services,
                &view,
                change,
                file,
                ResourceType::CustomEmoji,
                &community_id,
            )
            .await;
        let result = match uploaded {
            Ok(id) => match uuid(&id, "the uploaded file") {
                Ok(file_id) => {
                    services
                        .backend
                        .custom_emoji_controller_create_emoji(
                            community_id.clone(),
                            wire::CreateCustomEmojiDto { file_id, name },
                        )
                        .await
                }
                Err(error) => {
                    self.write(|state, _| state.w5a_op_end(&view, change, None));
                    return Err(error);
                }
            },
            Err(error) => Err(error),
        };
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, emoji| {
                let key = keys::scoped(k::EMOJIS, &community_id);
                if let Some(emojis) = state.cache.emojis_mut(&key) {
                    if !emojis.iter().any(|known| known.id == emoji.id) {
                        emojis.push(emoji.clone());
                        emojis.sort_by(|a, b| a.name.cmp(&b.name));
                    }
                    state.note_direct_update(&key);
                }
                state.view_changed(view.clone());
                // The pickers' list.
                state.w5a_reread(&keys::scoped(keys::EMOJIS, &community_id));
            },
            |_| {},
        )
        .map(|_| ())
    }

    /// Deletes an emoji: gone at once, back if the server refuses. Messages using it keep their
    /// `:name:` text.
    pub async fn delete_custom_emoji(
        &self,
        community_id: String,
        emoji_id: String,
    ) -> Result<(), CoreError> {
        let view = ViewKey::CustomEmoji {
            community_id: community_id.clone(),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a custom emoji")?;
        let key = keys::scoped(k::EMOJIS, &community_id);
        let removed = self.write(|state, _| {
            let emojis = state.cache.emojis_mut(&key)?;
            let index = emojis.iter().position(|emoji| emoji.id == emoji_id)?;
            let emoji = emojis.remove(index);
            state.note_direct_update(&key);
            state.view_changed(view.clone());
            Some((index, emoji))
        });
        let result = services
            .backend
            .custom_emoji_controller_delete_emoji(community_id.clone(), emoji_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_reread(&keys::scoped(keys::EMOJIS, &community_id)),
            |state| {
                let Some((index, emoji)) = removed else { return };
                if let Some(emojis) = state.cache.emojis_mut(&key)
                    && !emojis.iter().any(|known| known.id == emoji.id)
                {
                    emojis.insert(index.min(emojis.len()), emoji);
                    state.note_direct_update(&key);
                }
            },
        )
    }

    /// Uploads the sound (progress in `CommunitySettings`' `op.upload`), then adds it to the
    /// soundboard (W4's `Core::soundboard` lists it). Its name is 1 to 50 letters, digits,
    /// spaces, `_` or `-`; its emoji at most 16 characters.
    pub async fn add_sound(&self, community_id: String, draft: SoundDraft) -> Result<(), CoreError> {
        let view = ViewKey::CommunitySettings {
            community_id: community_id.clone(),
        };
        let name = draft
            .name
            .trim()
            .parse::<wire::CreateSoundboardSoundDtoName>()
            .map_err(|_| invalid("sound name"));
        let emoji = draft
            .emoji
            .as_deref()
            .map(str::trim)
            .filter(|emoji| !emoji.is_empty())
            .map(|emoji| emoji.parse::<wire::CreateSoundboardSoundDtoEmoji>())
            .transpose()
            .map_err(|_| invalid("sound emoji"));
        let (name, emoji) = match (name, emoji) {
            (Ok(name), Ok(emoji)) => (name, emoji),
            (Err(error), _) | (_, Err(error)) => return self.w5a_refuse(&view, error),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "adding a sound")?;
        let uploaded = self
            .w5a_upload(
                &services,
                &view,
                change,
                draft.file,
                ResourceType::SoundboardSound,
                &community_id,
            )
            .await;
        let result = match uploaded {
            Ok(id) => match uuid(&id, "the uploaded file") {
                Ok(file_id) => {
                    services
                        .backend
                        .soundboard_controller_create_sound(
                            community_id.clone(),
                            wire::CreateSoundboardSoundDto {
                                emoji,
                                file_id,
                                name,
                            },
                        )
                        .await
                }
                Err(error) => {
                    self.write(|state, _| state.w5a_op_end(&view, change, None));
                    return Err(error);
                }
            },
            Err(error) => Err(error),
        };
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, sound| {
                let key = keys::scoped(keys::SOUNDBOARD, &community_id);
                if let Some(sounds) = state.cache.soundboard_mut(&key)
                    && !sounds.iter().any(|known| known.id == sound.id)
                {
                    sounds.push(sound.clone());
                    sounds.sort_by(|a, b| a.name.cmp(&b.name));
                    state.note_direct_update(&key);
                }
                state.view_changed(ViewKey::Soundboard {
                    community_id: community_id.clone(),
                });
                state.w5a_reread(&key);
            },
            |_| {},
        )
        .map(|_| ())
    }

    /// Deletes a sound: gone from the soundboard at once, back if the server refuses.
    pub async fn delete_sound(&self, community_id: String, sound_id: String) -> Result<(), CoreError> {
        let view = ViewKey::CommunitySettings {
            community_id: community_id.clone(),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a sound")?;
        let key = keys::scoped(keys::SOUNDBOARD, &community_id);
        let sounds_view = ViewKey::Soundboard {
            community_id: community_id.clone(),
        };
        let removed = self.write(|state, _| {
            let sounds = state.cache.soundboard_mut(&key)?;
            let index = sounds.iter().position(|sound| sound.id == sound_id)?;
            let sound = sounds.remove(index);
            state.note_direct_update(&key);
            state.view_changed(sounds_view.clone());
            Some((index, sound))
        });
        let result = services
            .backend
            .soundboard_controller_delete_sound(community_id.clone(), sound_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, _| state.w5a_reread(&key),
            |state| {
                let Some((index, sound)) = removed else { return };
                if let Some(sounds) = state.cache.soundboard_mut(&key)
                    && !sounds.iter().any(|known| known.id == sound.id)
                {
                    sounds.insert(index.min(sounds.len()), sound);
                    state.note_direct_update(&key);
                    state.view_changed(sounds_view.clone());
                }
            },
        )
    }

    /// A channel's webhooks (`ViewKey::Webhooks`), oldest first. Their URLs aren't here: only
    /// `create_webhook`'s answer has one.
    pub fn webhooks(&self, channel_id: String) -> WebhooksView {
        self.write(|state, now| {
            let key = keys::scoped(k::WEBHOOKS, &channel_id);
            state.w5a_ensure(&key, now, true);
            let view = ViewKey::Webhooks {
                channel_id: channel_id.clone(),
            };
            WebhooksView {
                state: state.query_load_state(&key),
                webhooks: state
                    .w5a_webhooks(&key)
                    .map(|webhooks| {
                        webhooks
                            .iter()
                            .map(|webhook| WebhookRow {
                                id: webhook.id.clone(),
                                name: webhook.name.clone(),
                                avatar_url: webhook.avatar_url.clone(),
                                created_at_ms: webhook.created_at.timestamp_millis(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                op: state.w5a_op(&view),
                channel_id,
            }
        })
    }

    /// Makes a webhook (text channels only; its name 1 to 80 characters). Its URL is in the answer
    /// only: core keeps the webhook without it, and nothing shows it again.
    pub async fn create_webhook(
        &self,
        channel_id: String,
        name: String,
    ) -> Result<CreatedWebhook, CoreError> {
        let view = ViewKey::Webhooks {
            channel_id: channel_id.clone(),
        };
        let body = match name.trim().parse::<wire::CreateWebhookDtoName>() {
            Ok(name) => wire::CreateWebhookDto {
                avatar_url: None,
                name,
            },
            Err(_) => return self.w5a_refuse(&view, invalid("webhook name")),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating a webhook")?;
        let result = services
            .backend
            .webhooks_controller_create(channel_id.clone(), body)
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, created| {
                let kept = wire::WebhookDto {
                    avatar_url: created.avatar_url.clone(),
                    channel_id: created.channel_id.clone(),
                    created_at: created.created_at,
                    id: created.id.clone(),
                    name: created.name.clone(),
                };
                state.w5a_webhooks_edit(&keys::scoped(k::WEBHOOKS, &channel_id), |webhooks| {
                    if !webhooks.iter().any(|known| known.id == kept.id) {
                        webhooks.push(kept);
                    }
                });
            },
            |_| {},
        )
        .map(|created| CreatedWebhook {
            id: created.id,
            url: created.url,
        })
    }

    /// Deletes a webhook: gone at once, back if the server refuses.
    pub async fn delete_webhook(
        &self,
        channel_id: String,
        webhook_id: String,
    ) -> Result<(), CoreError> {
        let view = ViewKey::Webhooks {
            channel_id: channel_id.clone(),
        };
        let (services, epoch, change) = self.w5a_begin(&view, "deleting a webhook")?;
        let key = keys::scoped(k::WEBHOOKS, &channel_id);
        let removed = self.write(|state, _| {
            state
                .w5a_webhooks_edit(&key, |webhooks| {
                    let index = webhooks.iter().position(|webhook| webhook.id == webhook_id)?;
                    Some((index, webhooks.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .webhooks_controller_remove(channel_id.clone(), webhook_id.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |_, _, _| {},
            |state| {
                let Some((index, webhook)) = removed else { return };
                state.w5a_webhooks_edit(&key, |webhooks| {
                    if !webhooks.iter().any(|known| known.id == webhook.id) {
                        webhooks.insert(index.min(webhooks.len()), webhook);
                    }
                });
            },
        )
    }

    /// My invites that include this community, newest first (`ViewKey::Invites`; the server lists
    /// all of mine, the web shows them all). Making one needs instance CREATE_INSTANCE_INVITE and
    /// community CREATE_INVITE.
    pub fn community_invites(&self, community_id: String) -> InvitesView {
        self.write(|state, now| {
            let key = keys::op(k::INVITES);
            state.w5a_ensure(&key, now, true);
            InvitesView {
                state: state.query_load_state(&key),
                invites: state
                    .w5a_invites(&key)
                    .map(|invites| {
                        invites
                            .iter()
                            .filter(|invite| {
                                invite
                                    .default_communities
                                    .iter()
                                    .any(|community| community.community_id == community_id)
                            })
                            .map(|invite| InviteRow {
                                code: invite.code.clone(),
                                uses: invite.uses.clamp(0, i64::from(u32::MAX)) as u32,
                                max_uses: invite
                                    .max_uses
                                    .map(|max| max.clamp(0, i64::from(u32::MAX)) as u32),
                                valid_until_ms: invite.valid_until.map(|at| at.timestamp_millis()),
                                disabled: invite.disabled,
                                created_at_ms: invite.created_at.timestamp_millis(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                op: state.w5a_op(&ViewKey::Invites),
                community_id,
            }
        })
    }

    /// Makes an invite to this community; returns its code.
    pub async fn create_invite(
        &self,
        community_id: String,
        draft: InviteDraft,
    ) -> Result<String, CoreError> {
        let view = ViewKey::Invites;
        let community = match uuid(&community_id, "the community") {
            Ok(community) => community,
            Err(error) => return self.w5a_refuse(&view, error),
        };
        let valid_until = match draft.valid_until_ms {
            None => None,
            Some(ms) => match chrono::DateTime::from_timestamp_millis(ms) {
                Some(at) => Some(at),
                None => return self.w5a_refuse(&view, invalid("expiry")),
            },
        };
        let body = wire::CreateInviteDto {
            community_ids: vec![community],
            max_uses: draft
                .max_uses
                .and_then(|max| std::num::NonZeroU64::new(u64::from(max))),
            valid_until,
        };
        let (services, epoch, change) = self.w5a_begin(&view, "creating an invite")?;
        let result = services.backend.invite_controller_create_invite(body).await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |state, _, invite| {
                state.w5a_invites_edit(&keys::op(k::INVITES), |invites| {
                    if !invites.iter().any(|known| known.code == invite.code) {
                        invites.insert(0, invite.clone());
                    }
                });
            },
            |_| {},
        )
        .map(|invite| invite.code)
    }

    /// Deletes one of my invites: gone at once, back if the server refuses.
    pub async fn delete_invite(&self, code: String) -> Result<(), CoreError> {
        let view = ViewKey::Invites;
        let (services, epoch, change) = self.w5a_begin(&view, "deleting an invite")?;
        let key = keys::op(k::INVITES);
        let removed = self.write(|state, _| {
            state
                .w5a_invites_edit(&key, |invites| {
                    let index = invites.iter().position(|invite| invite.code == code)?;
                    Some((index, invites.remove(index)))
                })
                .flatten()
        });
        let result = services
            .backend
            .invite_controller_delete_invite(code.clone())
            .await;
        self.w5a_settle(
            epoch,
            &view,
            change,
            result,
            |_, _, _| {},
            |state| {
                let Some((index, invite)) = removed else { return };
                state.w5a_invites_edit(&key, |invites| {
                    if !invites.iter().any(|known| known.code == invite.code) {
                        invites.insert(index.min(invites.len()), invite);
                    }
                });
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::emoji_name_ok;

    #[test]
    fn emoji_names_follow_the_backends_rule() {
        for good in ["ok", "party_parrot", "a1", "x_9"] {
            assert!(emoji_name_ok(good), "{good}");
        }
        for bad in ["a", "12", "__", "Big", "has space", "émoji", &"a".repeat(33)] {
            assert!(!emoji_name_ok(bad), "{bad}");
        }
    }
}
