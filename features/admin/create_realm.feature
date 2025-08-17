Feature: Create a new realm in Tidecloak
  As a Tide Cloak admin user
  I want to create a realm in Tidecloak
  
  Scenario: Admin creates a new realm successfully
    Given the admin is logged in to the Tidecloak admin console
    When the admin creates a realm named "testrealm"
    Then the realm "testrealm" should be visible in the realm list