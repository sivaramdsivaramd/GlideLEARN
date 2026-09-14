"""
GlideLEARN backend — roles.py

Mirrors the role/field setup in the frontend's script.js so the
server validates signups the same way the form does.
"""

# Which dynamic fields each role's signup form collects, and which
# of those fields identifies the account (used to log in alongside
# the generated login code).
ROLE_FIELDS = {
    "student": {
        "prefix": "STU",
        "identityField": "email",
        "fields": ["fullName", "email", "standard", "schoolName"],
    },
    "teacher": {
        "prefix": "TCH",
        "identityField": "email",
        "fields": ["fullName", "email", "subject", "schoolName"],
    },
    "parent": {
        "prefix": "PAR",
        # Parents don't have their own email field in the form — they
        # link to their child's account, so the student's email is
        # what identifies them for login purposes.
        "identityField": "studentEmail",
        "fields": ["fullName", "studentEmail", "studentPassword"],
    },
    "management": {
        "prefix": "MGT",
        "identityField": "email",
        "fields": ["fullName", "email", "position", "schoolName"],
    },
}

VALID_ROLES = list(ROLE_FIELDS.keys())
