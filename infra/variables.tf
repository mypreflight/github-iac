variable "organization" {
  description = "GitHub organization login managed by this configuration."
  type        = string
  default     = "mypreflight"
}

variable "state_passphrase" {
  description = "Passphrase for OpenTofu state encryption (min. 16 characters). Set via TF_VAR_state_passphrase."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "The state passphrase must be at least 16 characters long."
  }
}
