Feature: Delete a realm in Tidecloak

  Scenario: Admin delete a realm successfully
    Given the admin is logged in to the Tidecloak admin console
    When the admin deletes a realm named "testrealm"
    Then the realm "testrealm" should not be visible in the realm list