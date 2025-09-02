Feature: Delete a realm in Tidecloak
  As a Tide Cloak admin user
  I want to delete a realm in Tidecloak

  @realm_action
  Scenario: Admin delete a realm successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin deletes a realm named <realm_name>
    Then the realm <realm_name> should not be visible in the realm list

    Examples:
      | realm_name |
      | testrealm  |