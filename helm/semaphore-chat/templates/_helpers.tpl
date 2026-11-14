{{/*
Expand the name of the chart.
*/}}
{{- define "semaphore-chat.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "semaphore-chat.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "semaphore-chat.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "semaphore-chat.labels" -}}
helm.sh/chart: {{ include "semaphore-chat.chart" . }}
{{ include "semaphore-chat.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "semaphore-chat.selectorLabels" -}}
app.kubernetes.io/name: {{ include "semaphore-chat.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend labels
*/}}
{{- define "semaphore-chat.backend.labels" -}}
{{ include "semaphore-chat.labels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Backend selector labels
*/}}
{{- define "semaphore-chat.backend.selectorLabels" -}}
{{ include "semaphore-chat.selectorLabels" . }}
app.kubernetes.io/component: backend
{{- end }}

{{/*
Frontend labels
*/}}
{{- define "semaphore-chat.frontend.labels" -}}
{{ include "semaphore-chat.labels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "semaphore-chat.frontend.selectorLabels" -}}
{{ include "semaphore-chat.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "semaphore-chat.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "semaphore-chat.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL URI - either from bundled or external. The password is URL-encoded.
Only ever rendered into a Secret (templates/backend/database-secret.yaml).
*/}}
{{- define "semaphore-chat.postgresql.uri" -}}
{{- if .Values.postgresql.bundled -}}
postgresql://{{ .Values.postgresql.auth.username | urlquery }}:{{ .Values.postgresql.auth.password | toString | urlquery }}@{{ include "semaphore-chat.fullname" . }}-postgresql:5432/{{ .Values.postgresql.auth.database }}
{{- else -}}
{{ .Values.postgresql.external.uri }}
{{- end -}}
{{- end }}

{{/*
Whether the chart renders its own <fullname>-database Secret: for the bundled
database or an external one given as postgresql.external.uri.
*/}}
{{- define "semaphore-chat.database.chartSecret" -}}
{{- if or .Values.postgresql.bundled (and (not .Values.postgresql.external.existingSecret) .Values.postgresql.external.uri) -}}
true
{{- end -}}
{{- end }}

{{/*
The DATABASE_URL env entry (backend and migration job): from the chart's
database Secret, postgresql.external.existingSecret, or (external database,
neither set) the DATABASE_URL key of secrets.existingSecret.
*/}}
{{- define "semaphore-chat.database.env" -}}
{{- $name := printf "%s-database" (include "semaphore-chat.fullname" .) -}}
{{- $key := "DATABASE_URL" -}}
{{- if not .Values.postgresql.bundled -}}
{{- if .Values.postgresql.external.existingSecret -}}
{{- $name = .Values.postgresql.external.existingSecret -}}
{{- $key = .Values.postgresql.external.existingSecretKey | default "DATABASE_URL" -}}
{{- else if not .Values.postgresql.external.uri -}}
{{- if .Values.secrets.existingSecret -}}
{{- $name = .Values.secrets.existingSecret -}}
{{- else -}}
{{- fail "semaphore-chat: postgresql.bundled=false needs postgresql.external.uri or postgresql.external.existingSecret (a Secret holding the URL)." -}}
{{- end -}}
{{- end -}}
{{- end -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ $name }}
      key: {{ $key }}
{{- end }}

{{/*
Redis host - either from bundled or external
*/}}
{{- define "semaphore-chat.redis.host" -}}
{{- if .Values.redis.bundled }}
{{- printf "%s-redis-master" (include "semaphore-chat.fullname" .) }}
{{- else }}
{{- .Values.redis.external.host }}
{{- end }}
{{- end }}

{{/*
Redis port - either from bundled or external
*/}}
{{- define "semaphore-chat.redis.port" -}}
{{- if .Values.redis.bundled }}
{{- print "6379" }}
{{- else }}
{{- .Values.redis.external.port | toString }}
{{- end }}
{{- end }}

{{/*
Redis password - either from bundled or external
*/}}
{{- define "semaphore-chat.redis.password" -}}
{{- if .Values.redis.bundled }}
{{- .Values.redis.auth.password }}
{{- else }}
{{- .Values.redis.external.password }}
{{- end }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "semaphore-chat.imagePullSecrets" -}}
{{- if .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.global.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Backend image
*/}}
{{- define "semaphore-chat.backend.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repository := .Values.backend.image.repository }}
{{- $tag := .Values.backend.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repository $tag }}
{{- else }}
{{- printf "%s:%s" $repository $tag }}
{{- end }}
{{- end }}

{{/*
Potential backend replica count: the largest number of backend pods that
could ever run concurrently under the given config. This is
backend.autoscaling.maxReplicas when HPA is enabled — because the HPA can
scale up to that value at any time regardless of minReplicas — otherwise
backend.replicaCount. Using minReplicas here would let an HPA configured with
minReplicas=1/maxReplicas=3 sail past the storage-safety guards below and
then hit the ephemeral-storage / RWO-PVC failure mode at runtime once it
scales up.
*/}}
{{- define "semaphore-chat.backend.potentialReplicas" -}}
{{- if .Values.backend.autoscaling.enabled -}}
{{- .Values.backend.autoscaling.maxReplicas | int -}}
{{- else -}}
{{- .Values.backend.replicaCount | int -}}
{{- end -}}
{{- end }}

{{/*
Effective accessMode for the fileStorage uploads PVC. fileStorage.accessMode
is "auto" when left empty: ReadWriteMany when fileStorage.nfs.enabled (the
chart-managed NFS PersistentVolume only ever advertises ReadWriteMany, so an
auto-selected ReadWriteOnce PVC could never bind to it), otherwise
ReadWriteOnce when the backend can only ever run 1 pod (see
semaphore-chat.backend.potentialReplicas), ReadWriteMany once more than one
pod could run concurrently. An explicit fileStorage.accessMode value always
overrides auto-detection — including for NFS mode, so setting it to
ReadWriteOnce with fileStorage.nfs.enabled=true is possible but will always
fail to bind (see semaphore-chat.validateFileStorage, which rejects that
combination at render time rather than leaving the PVC Pending forever).
*/}}
{{- define "semaphore-chat.fileStorage.accessMode" -}}
{{- if .Values.fileStorage.accessMode -}}
{{- .Values.fileStorage.accessMode -}}
{{- else if .Values.fileStorage.nfs.enabled -}}
{{- print "ReadWriteMany" -}}
{{- else -}}
{{- $replicas := include "semaphore-chat.backend.potentialReplicas" . | int -}}
{{- if gt $replicas 1 -}}
{{- print "ReadWriteMany" -}}
{{- else -}}
{{- print "ReadWriteOnce" -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Guard against data-loss/unschedulable/misconfigured combinations of backend
scale, file storage config, and S3 object storage config:

1. Ephemeral storage with more than one pod. Uploaded files live on per-pod
   disk when fileStorage.enabled=false, so with more than one potential
   backend replica (see semaphore-chat.backend.potentialReplicas), uploads
   404 on the other pods and are lost on restart. Fails unless the operator
   has opted in via fileStorage.allowEphemeral=true.

   NOT triggered when fileStorage.s3.enabled=true: with no PVC at all
   (fileStorage.enabled=false) and S3 handling uploads, there is no ephemeral
   per-pod disk in the upload path, so scaling to any number of replicas is
   safe without allowEphemeral.

2. A ReadWriteOnce uploads PVC with more than one potential backend replica.
   Only one pod can mount an RWO volume at a time, so the other pod(s) would
   fail to schedule. Fails unless the operator switches to an RWX-capable
   accessMode.

   Still applies even when fileStorage.s3.enabled=true, AS LONG AS
   fileStorage.enabled is ALSO true: that combination ("mixed mode") keeps
   the uploads PVC mounted to serve files that were uploaded before the
   switch to S3 (STORAGE_TYPE=LOCAL), so the PVC's accessMode/RWX
   requirements still apply to it independently of S3. The failure message is
   adjusted to explain the mixed-mode reason and mention that
   fileStorage.enabled=false is also a valid fix once no LOCAL-storage files
   remain (S3 itself needs no PVC).

3. fileStorage.nfs.enabled=true with an effective accessMode of
   ReadWriteOnce. The chart-managed NFS PersistentVolume (templates/backend/
   pv.yaml) only ever advertises ReadWriteMany, so a ReadWriteOnce PVC can
   never bind to it — it would sit Pending forever regardless of replica
   count. This can only happen via an explicit fileStorage.accessMode
   override (auto-detection already forces ReadWriteMany for NFS), so this
   guard fires independently of potentialReplicas and of S3.

4. fileStorage.s3.enabled=true with missing required S3 config: bucket,
   region, and credentials via exactly one of existingSecret or the inline
   accessKeyId/secretAccessKey pair. Mirrors the backend's own imperative
   validation for STORAGE_TYPE=S3 (see backend/src/config/env.validation.ts)
   so misconfiguration fails at `helm template`/`helm install` time instead
   of as a backend crash loop.

When fileStorage.s3.enabled=false, none of the S3-specific carve-outs above
apply and this guard behaves byte-identically to its pre-S3 form.
*/}}
{{- define "semaphore-chat.validateFileStorage" -}}
{{- $replicas := include "semaphore-chat.backend.potentialReplicas" . | int -}}
{{- $s3 := .Values.fileStorage.s3 -}}
{{- if and (gt $replicas 1) (not .Values.fileStorage.enabled) (not $s3.enabled) (not .Values.fileStorage.allowEphemeral) -}}
{{- fail (printf "semaphore-chat: backend can scale up to %d replicas (backend.replicaCount / backend.autoscaling.maxReplicas) but fileStorage.enabled=false. Ephemeral storage is per-pod: uploaded files will 404 on other pods and be lost on restart. Fix by doing ONE of: (1) set fileStorage.enabled=true and configure a ReadWriteMany-capable backend (fileStorage.nfs.enabled=true or fileStorage.storageClassName pointing at an RWX storage class), (2) set fileStorage.s3.enabled=true to store uploads in S3 instead (no PVC required), (3) cap backend.replicaCount=1 and backend.autoscaling.maxReplicas=1 (or disable autoscaling), or (4) accept the data-loss risk with --set fileStorage.allowEphemeral=true." $replicas) -}}
{{- end -}}
{{- if and (gt $replicas 1) .Values.fileStorage.enabled (eq (include "semaphore-chat.fileStorage.accessMode" .) "ReadWriteOnce") -}}
{{- if $s3.enabled -}}
{{- fail (printf "semaphore-chat: fileStorage.s3.enabled=true, but fileStorage.enabled=true also keeps the local uploads PVC mounted (mixed mode, for files uploaded before switching to S3) and that PVC would use ReadWriteOnce while the backend can scale up to %d replicas — only one pod can mount it. Fix by doing ONE of: (1) point fileStorage at an RWX-capable storage class (fileStorage.nfs.enabled=true or fileStorage.storageClassName) and set fileStorage.accessMode=ReadWriteMany, (2) cap the backend at 1 potential replica, or (3) once no LOCAL-storage files remain, set fileStorage.enabled=false — S3 uploads don't need the PVC at all." $replicas) -}}
{{- else -}}
{{- fail (printf "semaphore-chat: backend can scale up to %d replicas (backend.replicaCount / backend.autoscaling.maxReplicas) but the uploads PVC would use ReadWriteOnce, which only one pod can mount at a time. Point fileStorage at an RWX-capable storage class (fileStorage.nfs.enabled=true or fileStorage.storageClassName pointing at NFS/EFS/AzureFile/etc.) and set fileStorage.accessMode=ReadWriteMany, or cap the backend at 1 potential replica." $replicas) -}}
{{- end -}}
{{- end -}}
{{- if and .Values.fileStorage.enabled .Values.fileStorage.nfs.enabled (eq (include "semaphore-chat.fileStorage.accessMode" .) "ReadWriteOnce") -}}
{{- fail "semaphore-chat: fileStorage.nfs.enabled=true but fileStorage.accessMode is explicitly set to ReadWriteOnce. The chart-managed NFS PersistentVolume only advertises ReadWriteMany, so a ReadWriteOnce PVC can never bind to it and would stay Pending indefinitely. Remove the fileStorage.accessMode override (auto-detection already forces ReadWriteMany for NFS) or set it to ReadWriteMany." -}}
{{- end -}}
{{- if $s3.enabled -}}
{{- if not $s3.bucket -}}
{{- fail "semaphore-chat: fileStorage.s3.enabled=true requires fileStorage.s3.bucket to be set." -}}
{{- end -}}
{{- if not $s3.region -}}
{{- fail "semaphore-chat: fileStorage.s3.enabled=true requires fileStorage.s3.region to be set." -}}
{{- end -}}
{{- if and (not $s3.existingSecret) (or (not $s3.accessKeyId) (not $s3.secretAccessKey)) -}}
{{- fail "semaphore-chat: fileStorage.s3.enabled=true requires S3 credentials. Set fileStorage.s3.existingSecret to a pre-created Secret containing the access key ID / secret access key (see existingSecretAccessKeyIdKey / existingSecretSecretAccessKeyKey), or set both fileStorage.s3.accessKeyId and fileStorage.s3.secretAccessKey to have the chart create one." -}}
{{- end -}}
{{- end -}}
{{- end }}

{{/*
Frontend image
*/}}
{{- define "semaphore-chat.frontend.image" -}}
{{- $registry := .Values.global.imageRegistry | default "" }}
{{- $repository := .Values.frontend.image.repository }}
{{- $tag := .Values.frontend.image.tag | default .Chart.AppVersion }}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repository $tag }}
{{- else }}
{{- printf "%s:%s" $repository $tag }}
{{- end }}
{{- end }}

{{/*
Refuse to render with unsafe secrets: anyone who knows a placeholder or
default value can sign a session for any user (JWT) or join every voice
room (LiveKit). The backend refuses the same values at startup; failing here
stops `helm install/upgrade` before anything changes. Secrets are not
generated: `lookup` returns nothing under `helm template` and GitOps tools,
which would rotate them (signing everyone out) on every sync.
*/}}
{{- define "semaphore-chat.secretProblem" -}}
{{- $value := .value | default "" | toString -}}
{{- if not $value -}}
is empty
{{- else if regexMatch "(?i)change[-_ ]?me|replace[-_ ]?with|your[-_ ]|example|devkey|secret-that-is-at-least|elaborate secret" $value -}}
is a published placeholder
{{- else if lt (len $value) 32 -}}
is shorter than 32 characters
{{- end -}}
{{- end }}

{{- define "semaphore-chat.validateSecrets" -}}
{{- $fix := "Generate it with: openssl rand -base64 64 | tr -d '\\n' (a different value for each secret), or set secrets.existingSecret." -}}
{{- if not .Values.secrets.existingSecret -}}
{{- range $key := list "jwtSecret" "jwtRefreshSecret" -}}
{{- $problem := include "semaphore-chat.secretProblem" (dict "value" (index $.Values.secrets $key)) -}}
{{- if $problem -}}
{{- fail (printf "semaphore-chat: secrets.%s %s. %s" $key $problem $fix) -}}
{{- end -}}
{{- end -}}
{{- if eq (toString .Values.secrets.jwtSecret) (toString .Values.secrets.jwtRefreshSecret) -}}
{{- fail (printf "semaphore-chat: secrets.jwtSecret and secrets.jwtRefreshSecret are the same value; they must differ. %s" $fix) -}}
{{- end -}}
{{- end -}}
{{- $lk := .Values.livekit -}}
{{- if or $lk.url $lk.apiKey $lk.apiSecret -}}
{{- if or (not $lk.url) (not $lk.apiKey) -}}
{{- fail "semaphore-chat: voice/video needs livekit.url, livekit.apiKey and livekit.apiSecret together (or none of them)." -}}
{{- end -}}
{{- if not .Values.secrets.existingSecret -}}
{{- $problem := include "semaphore-chat.secretProblem" (dict "value" $lk.apiSecret) -}}
{{- if $problem -}}
{{- fail (printf "semaphore-chat: livekit.apiSecret %s. Use your LiveKit server's real key pair (generate a secret with: openssl rand -hex 32), or set secrets.existingSecret." $problem) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}
