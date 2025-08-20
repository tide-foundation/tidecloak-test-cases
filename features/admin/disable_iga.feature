Feature: Disable IGA in admin console
    As a Tide Cloak admin user
    I want to enable Identity Governance and Administration (IGA) 

  Scenario: Admin disables IGA
    Given the admin is logged in to the Tidecloak admin console
    When the admin disables IGA 
    Then table in change request for clients is not visible